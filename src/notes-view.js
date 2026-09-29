/**
 * Notes view: a searchable, pinnable list of notes with inline editing.
 *
 * The component is self-contained — it owns its state, persistence and event
 * wiring — and exposes only `reload()` to `app.js`, which handles tab
 * switching. Like `app.js`, it writes user text with `textContent` only.
 *
 * Nothing here runs at module scope, so the file stays importable in Node.
 */

import { createButton } from './dom.js';
import {
  UNTITLED_NOTE,
  addNote,
  createInitialNotesState,
  removeNote,
  sanitizeNotes,
  selectVisibleNotes,
  serializeNotes,
  togglePin,
  updateNote,
} from './notes.js';
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from './shared.js';
import { loadState, saveState } from './storage.js';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const TITLE_ROLE = 'note-edit-title';
const BODY_ROLE = 'note-edit-body';

/** @returns {string} A human label for a note, used in accessible names. */
function noteLabel(note) {
  return note.title || UNTITLED_NOTE;
}

/**
 * @param {Object} options
 * @param {HTMLElement} options.panel   The notes tab panel (already in the DOM).
 * @param {{ read: () => string|null, write: (value: string) => boolean }} options.adapter
 * @param {(previousState: *, message: string) => void} [options.onDestructiveChange]
 *   Called before a destructive change is committed (deleting a note), so the
 *   shell can offer an undo.
 */
export function createNotesView({ panel, adapter, onDestructiveChange }) {
  const elements = {
    form: panel.querySelector('#new-note-form'),
    title: panel.querySelector('#new-note-title'),
    body: panel.querySelector('#new-note-body'),
    error: panel.querySelector('#note-error'),
    search: panel.querySelector('#note-search'),
    count: panel.querySelector('#notes-count'),
    list: panel.querySelector('#notes-list'),
    empty: panel.querySelector('#notes-empty'),
  };

  let state = loadState(adapter, sanitizeNotes) ?? createInitialNotesState();

  /** Id of the note whose editor is open (UI-only, never persisted). */
  let editingId = null;

  /** Current search query (UI-only, never persisted). */
  let query = '';

  /**
   * Unsaved editor contents. Any re-render rebuilds the list DOM, so the draft
   * is captured first and re-applied afterwards; otherwise typing in the search
   * box while editing would silently discard the note body.
   */
  let draft = null;
  let draftField = TITLE_ROLE;

  /** Set when an editor opens, so the first render focuses it. */
  let focusEditorOnRender = false;

  /* ---------------------------------------------------------------- update */

  /**
   * Applies a new state: no-op states are ignored, everything else is persisted
   * and re-rendered.
   *
   * @param {import('./notes.js').NotesState} nextState
   * @param {{ message?: string }} [options] `message` marks the change as
   *   destructive and offers it for undo, e.g. `Deleted "Milk"`.
   */
  function commit(nextState, options = {}) {
    if (nextState === state) return;

    const previous = state;
    state = nextState;
    saveState(adapter, state, serializeNotes);
    render();

    if (options.message && typeof onDestructiveChange === 'function') {
      onDestructiveChange(previous, options.message);
    }
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    const visible = selectVisibleNotes(state, query);
    renderList(visible);
    renderCount(visible.length);
  }

  function renderList(visible) {
    const hadFocus = editingId !== null && elements.list.contains(document.activeElement);
    captureDraft();

    elements.list.replaceChildren(...visible.map((note) => buildNote(note)));
    elements.list.hidden = visible.length === 0;
    elements.empty.hidden = visible.length > 0;
    elements.empty.textContent = emptyMessage(visible.length);

    if (editingId !== null && (focusEditorOnRender || hadFocus)) focusEditor();
  }

  function renderCount(shown) {
    const total = state.notes.length;

    if (total === 0) {
      elements.count.textContent = 'No notes';
    } else if (query.trim() !== '') {
      elements.count.textContent = `${shown} of ${total} note${total === 1 ? '' : 's'}`;
    } else {
      elements.count.textContent = total === 1 ? '1 note' : `${total} notes`;
    }
  }

  function emptyMessage(shown) {
    if (state.notes.length === 0) return 'No notes yet. Write your first note above.';
    if (shown === 0) return `No notes match “${query.trim()}”.`;
    return 'No notes to show.';
  }

  function captureDraft() {
    if (editingId === null) return;

    // Only capture from the editor that belongs to the note being edited.
    const form = elements.list.querySelector('[data-role="note-edit-form"]');
    if (!form || form.closest('.note')?.dataset.id !== editingId) return;

    const title = form.querySelector(`[data-role="${TITLE_ROLE}"]`);
    const body = form.querySelector(`[data-role="${BODY_ROLE}"]`);
    if (!title || !body) return;

    const focusedRole = document.activeElement?.dataset?.role;
    if (focusedRole === TITLE_ROLE || focusedRole === BODY_ROLE) draftField = focusedRole;
    draft = { title: title.value, body: body.value };
  }

  function focusEditor() {
    focusEditorOnRender = false;

    const field =
      elements.list.querySelector(`[data-role="${draftField}"]`) ??
      elements.list.querySelector(`[data-role="${TITLE_ROLE}"]`);
    if (!field) return;

    field.focus();
    field.setSelectionRange?.(field.value.length, field.value.length);
  }

  /* ----------------------------------------------------------------- items */

  function buildNote(note) {
    const article = document.createElement('article');
    article.className = 'note';
    article.dataset.id = note.id;
    article.classList.toggle('note--pinned', note.pinned);

    const header = document.createElement('header');
    header.className = 'note__header';

    const heading = document.createElement('h3');
    heading.className = 'note__title';
    if (note.title) {
      heading.textContent = note.title;
    } else {
      heading.textContent = UNTITLED_NOTE;
      heading.classList.add('note__title--untitled');
    }
    header.append(heading);

    if (note.updatedAt > 0) {
      const time = document.createElement('time');
      time.className = 'note__meta';
      time.dateTime = new Date(note.updatedAt).toISOString();
      time.textContent = `Updated ${dateFormatter.format(note.updatedAt)}`;
      header.append(time);
    }
    article.append(header);

    if (note.body) {
      const body = document.createElement('p');
      body.className = 'note__body';
      body.textContent = note.body;
      article.append(body);
    }

    article.append(note.id === editingId ? buildNoteForm(note) : buildNoteActions(note));
    return article;
  }

  function buildNoteActions(note) {
    const actions = document.createElement('div');
    actions.className = 'note__actions';

    const pin = createButton({
      label: note.pinned ? 'Pinned' : 'Pin',
      action: 'pin',
      ariaLabel: note.pinned ? `Unpin "${noteLabel(note)}"` : `Pin "${noteLabel(note)}"`,
    });
    pin.setAttribute('aria-pressed', String(note.pinned));

    actions.append(
      pin,
      createButton({ label: 'Edit', action: 'edit', ariaLabel: `Edit "${noteLabel(note)}"` }),
      createButton({ label: 'Delete', action: 'delete', ariaLabel: `Delete "${noteLabel(note)}"` }),
    );
    return actions;
  }

  function buildNoteForm(note) {
    const form = document.createElement('form');
    form.className = 'note__edit';
    form.dataset.role = 'note-edit-form';

    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'note__edit-title';
    title.value = draft?.title ?? note.title;
    title.maxLength = MAX_TITLE_LENGTH;
    title.placeholder = 'Title (optional)';
    title.dataset.role = TITLE_ROLE;
    title.setAttribute('aria-label', 'Note title');

    const body = document.createElement('textarea');
    body.className = 'note__edit-body';
    body.value = draft?.body ?? note.body;
    body.rows = 6;
    body.maxLength = MAX_BODY_LENGTH;
    body.placeholder = 'Write your note…';
    body.dataset.role = BODY_ROLE;
    body.setAttribute('aria-label', 'Note body');

    const save = createButton({ label: 'Save', variant: 'primary' });
    save.type = 'submit';
    const cancel = createButton({ label: 'Cancel', variant: 'ghost', action: 'cancel' });

    form.append(title, body, save, cancel);
    return form;
  }

  /* --------------------------------------------------------------- editing */

  function startEditing(id) {
    draft = null;
    draftField = TITLE_ROLE;
    editingId = id;
    focusEditorOnRender = true;
    render();
  }

  function stopEditing() {
    draft = null;
    draftField = TITLE_ROLE;
    editingId = null;
    focusEditorOnRender = false;
    render();
  }

  function showError() {
    elements.error.hidden = false;
    elements.title.setAttribute('aria-invalid', 'true');
    elements.body.setAttribute('aria-invalid', 'true');
    elements.title.focus();
  }

  function hideError() {
    if (elements.error.hidden) return;
    elements.error.hidden = true;
    elements.title.removeAttribute('aria-invalid');
    elements.body.removeAttribute('aria-invalid');
  }

  /* ---------------------------------------------------------------- events */

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const added = addNote(state, { title: elements.title.value, body: elements.body.value });
    if (added === state) {
      showError();
      return;
    }

    hideError();
    elements.title.value = '';
    elements.body.value = '';
    editingId = null;
    commit(added);
  });

  // Enter inserts a newline in a textarea, so Cmd/Ctrl + Enter submits instead.
  elements.body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    elements.form.requestSubmit();
  });

  elements.title.addEventListener('input', hideError);
  elements.body.addEventListener('input', hideError);

  // The search field lives outside the list, so re-rendering keeps its focus.
  elements.search.addEventListener('input', () => {
    query = elements.search.value;
    render();
  });

  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const id = button?.closest('.note')?.dataset.id;
    if (!button || !id) return;

    switch (button.dataset.action) {
      case 'pin':
        commit(togglePin(state, id));
        break;
      case 'edit':
        startEditing(id);
        break;
      case 'cancel':
        stopEditing();
        break;
      case 'delete': {
        const note = state.notes.find((item) => item.id === id);
        draft = null;
        editingId = null;
        commit(removeNote(state, id), { message: `Deleted "${note ? noteLabel(note) : 'note'}"` });
        break;
      }
      default:
        break;
    }
  });

  elements.list.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-role="note-edit-form"]');
    if (!form) return;
    event.preventDefault();

    const id = form.closest('.note')?.dataset.id;
    const title = form.querySelector(`[data-role="${TITLE_ROLE}"]`);
    const body = form.querySelector(`[data-role="${BODY_ROLE}"]`);
    if (!id || !title || !body) return;

    const next = updateNote(state, id, { title: title.value, body: body.value });
    draft = null;
    draftField = TITLE_ROLE;
    editingId = null;

    // Blank or unchanged is a no-op: just close the editor.
    if (next === state) {
      render();
      return;
    }
    commit(next);
  });

  elements.list.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !event.target.closest('[data-role="note-edit-form"]')) return;
    event.preventDefault();
    stopEditing();
  });

  elements.list.addEventListener('dblclick', (event) => {
    const id = event.target.closest('.note__header, .note__body')?.closest('.note')?.dataset.id;
    if (!id) return;
    startEditing(id);
  });

  /* ------------------------------------------------------------------ init */

  render();

  /**
   * Adopts state written by another tab. Only called from the `storage` event,
   * which never fires for this tab's own writes.
   */
  function reload() {
    if (editingId !== null) return; // never discard an open editor
    state = loadState(adapter, sanitizeNotes) ?? createInitialNotesState();
    render();
  }

  /**
   * Replaces the whole notes state, discarding any open editor. Used by undo
   * and by importing a backup, both of which swap the data out from under the
   * UI.
   *
   * @param {import('./notes.js').NotesState} nextState
   * @param {{ clearSearch?: boolean }} [options] `clearSearch` also resets the
   *   search box, so imported notes are not hidden behind a stale query.
   */
  function replaceState(nextState, options = {}) {
    state = nextState;
    draft = null;
    draftField = TITLE_ROLE;
    editingId = null;
    focusEditorOnRender = false;

    if (options.clearSearch) {
      elements.search.value = '';
      query = '';
    }

    saveState(adapter, state, serializeNotes);
    render();
  }

  return { reload, replaceState, getState: () => state };
}
