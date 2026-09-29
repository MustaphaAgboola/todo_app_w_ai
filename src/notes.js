/**
 * Framework-agnostic note state logic.
 *
 * Mirrors the conventions in `store.js`: every reducer is pure, returns the very
 * same reference when nothing changed, and knows nothing about the DOM.
 *
 * A note is *content* rather than a task: it carries a title (which may be
 * empty when the body says enough), a multi-line body and a `pinned` flag.
 *
 * @typedef {Object} Note
 * @property {string}  id         Unique identifier.
 * @property {string}  title      Normalised; `''` for body-only notes.
 * @property {string}  body       Normalised, multi-line.
 * @property {boolean} pinned     Pinned notes sort to the top.
 * @property {number}  createdAt  Epoch milliseconds.
 * @property {number}  updatedAt  Epoch milliseconds.
 *
 * @typedef {Object} NotesState
 * @property {Note[]} notes
 */

import { defaultIdFactory, isPlainObject, normalizeBody, normalizeTitle, resolveId, resolveTimestamp } from './shared.js';

/** Bumped whenever the persisted shape changes so old data can be migrated. */
export const NOTES_SCHEMA_VERSION = 1;

/** Shown instead of a title for notes that only have a body. */
export const UNTITLED_NOTE = 'Untitled note';

/**
 * @returns {NotesState} A brand new, empty state.
 */
export function createInitialNotesState() {
  return { notes: [] };
}

/**
 * @param {{ title?: unknown, body?: unknown }} input
 * @returns {{ title: string, body: string }} Normalised content.
 */
export function normalizeNoteContent(input = {}) {
  return {
    title: normalizeTitle(input?.title),
    body: normalizeBody(input?.body),
  };
}

/**
 * @param {Note|undefined} note
 * @returns {boolean} True when the note has no title and no body.
 */
export function isNoteEmpty(note) {
  const { title, body } = normalizeNoteContent(note ?? {});
  return title === '' && body === '';
}

/**
 * Appends a new note. A note with neither a title nor a body is rejected
 * (the state is returned unchanged).
 *
 * @param {NotesState} state
 * @param {{ title?: string, body?: string }} input
 * @param {{ now?: number, idFactory?: () => string }} [options]
 * @returns {NotesState}
 */
export function addNote(state, input = {}, options = {}) {
  const { title, body } = normalizeNoteContent(input);
  if (title === '' && body === '') return state;

  const now = resolveTimestamp(options.now);
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;

  return {
    ...state,
    notes: [
      ...state.notes,
      {
        id: resolveId(idFactory, state.notes, 'note'),
        title,
        body,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

/**
 * Updates a note's title and/or body.
 *
 * Omitted fields (`undefined`) keep their current value, so callers can do
 * partial updates. A patch that would blank the note out completely is
 * rejected, as are patches that change nothing and unknown ids.
 *
 * @param {NotesState} state
 * @param {string} id
 * @param {{ title?: string, body?: string }} patch
 * @param {{ now?: number }} [options]
 * @returns {NotesState}
 */
export function updateNote(state, id, patch = {}, options = {}) {
  const existing = state.notes.find((note) => note.id === id);
  if (!existing) return state;

  const title = patch.title === undefined ? existing.title : normalizeTitle(patch.title);
  const body = patch.body === undefined ? existing.body : normalizeBody(patch.body);

  if (title === '' && body === '') return state;
  if (title === existing.title && body === existing.body) return state;

  const now = resolveTimestamp(options.now);
  return {
    ...state,
    notes: state.notes.map((note) => (note.id === id ? { ...note, title, body, updatedAt: now } : note)),
  };
}

/**
 * Flips a note's pinned flag, or forces it when `pinned` is a boolean.
 *
 * @param {NotesState} state
 * @param {string} id
 * @param {boolean} [pinned]
 * @param {{ now?: number }} [options]
 * @returns {NotesState}
 */
export function togglePin(state, id, pinned, options = {}) {
  const now = resolveTimestamp(options.now);
  let changed = false;

  const notes = state.notes.map((note) => {
    if (note.id !== id) return note;

    const nextPinned = typeof pinned === 'boolean' ? pinned : !note.pinned;
    if (nextPinned === note.pinned) return note;

    changed = true;
    return { ...note, pinned: nextPinned, updatedAt: now };
  });

  return changed ? { ...state, notes } : state;
}

/**
 * @param {NotesState} state
 * @param {string} id
 * @returns {NotesState}
 */
export function removeNote(state, id) {
  const notes = state.notes.filter((note) => note.id !== id);
  return notes.length === state.notes.length ? state : { ...state, notes };
}

function matchesQuery(note, needle) {
  return note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle);
}

/**
 * Sort order for display: pinned notes first, then most recently updated.
 * `Array.prototype.sort` is stable, so notes with equal timestamps keep their
 * insertion order.
 */
export function compareNotes(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  return 0;
}

/**
 * Notes matching a free-text query, in display order.
 *
 * The query is matched case-insensitively against the title *and* the body of
 * each note. The returned array is always a fresh copy, so sorting can never
 * reorder the state held in the store.
 *
 * @param {NotesState} state
 * @param {string} [query]
 * @returns {Note[]}
 */
export function selectVisibleNotes(state, query = '') {
  const needle = String(query ?? '').trim().toLowerCase();
  const matching = needle ? state.notes.filter((note) => matchesQuery(note, needle)) : state.notes;
  return [...matching].sort(compareNotes);
}

/** @param {NotesState} state @returns {number} */
export function countPinned(state) {
  return state.notes.reduce((total, note) => (note.pinned ? total + 1 : total), 0);
}

/**
 * Turns untrusted input (localStorage, a `storage` event) into a valid
 * NotesState. Notes with no id, no content at all, or a duplicate id are
 * dropped rather than crashing the app.
 *
 * @param {unknown} raw
 * @returns {NotesState}
 */
export function sanitizeNotes(raw) {
  const state = createInitialNotesState();
  if (!isPlainObject(raw)) return state;

  const seenIds = new Set();
  const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];

  for (const candidate of rawNotes) {
    if (!isPlainObject(candidate)) continue;

    const { title, body } = normalizeNoteContent(candidate);
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!id || (title === '' && body === '') || seenIds.has(id)) continue;

    seenIds.add(id);
    const createdAt = Number.isFinite(candidate.createdAt) ? candidate.createdAt : 0;

    state.notes.push({
      id,
      title,
      body,
      pinned: candidate.pinned === true,
      createdAt,
      updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : createdAt,
    });
  }

  return state;
}

/**
 * @param {NotesState} state
 * @returns {{ version: number, notes: Note[] }} A serialisable snapshot.
 */
export function serializeNotes(state) {
  return {
    version: NOTES_SCHEMA_VERSION,
    notes: state.notes.map((note) => ({ ...note })),
  };
}
