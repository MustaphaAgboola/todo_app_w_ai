/**
 * Backup documents: all of the app's data in one portable JSON file.
 *
 * Reading a backup is exactly as untrusted as reading `localStorage`, so the
 * very same sanitizers are reused here. This module is pure — no DOM, no
 * download plumbing — so the format can be unit tested directly.
 */

import { sanitizeNotes, serializeNotes } from './notes.js';
import { isPlainObject } from './shared.js';
import { sanitizeState, serializeState } from './store.js';

/** Marker written into every backup so we can recognise our own files. */
export const BACKUP_FORMAT = 'tasks-and-notes';

/** Bumped when the backup envelope changes shape. */
export const BACKUP_VERSION = 1;

/**
 * @param {{ todos: *, notes: * }} data Snapshots from the two stores.
 * @param {{ exportedAt?: number }} [options]
 * @returns {{ format: string, version: number, exportedAt: number, todos: *, notes: * }}
 */
export function buildBackup({ todos, notes }, options = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Number.isFinite(options.exportedAt) ? options.exportedAt : Date.now(),
    todos: serializeState(todos),
    notes: serializeNotes(notes),
  };
}

/**
 * @param {number} [now] Timestamp to name the file after.
 * @returns {string} e.g. 'tasks-and-notes-2026-09-29.json'
 */
export function backupFileName(now = Date.now()) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return 'tasks-and-notes.json';
  return `tasks-and-notes-${date.toISOString().slice(0, 10)}.json`;
}

/**
 * Reads the task half of a document.
 *
 * A backup nests the task state under `todos` (`{ todos: { todos: [...] } }`),
 * while a raw copy of the `localStorage` value carries the array directly
 * (`{ version, todos: [...] }`). Both are accepted.
 *
 * @returns {*|null} The task state, or `null` when the document has no tasks.
 */
function readTasks(payload) {
  if (isPlainObject(payload.todos)) return sanitizeState(payload.todos);
  if (Array.isArray(payload.todos)) return sanitizeState(payload);
  return null;
}

/**
 * Reads the notes half of a document, which is nested in a backup but sits at
 * the top level of a raw notes dump.
 *
 * @returns {*|null} The notes state, or `null` when the document has no notes.
 */
function readNotes(payload) {
  if (isPlainObject(payload.notes)) return sanitizeNotes(payload.notes);
  if (Array.isArray(payload.notes)) return sanitizeNotes(payload);
  return null;
}

/**
 * Parses a backup, accepting either a full backup or a document that holds only
 * tasks or only notes (such as a raw copy of a `localStorage` value). Anything
 * else is rejected with a reason the UI can turn into a message.
 *
 * @param {unknown} raw A JSON string, or an already parsed value.
 * @returns {{ ok: true, todos: *|null, notes: *|null }
 *   | { ok: false, reason: 'invalid-json'|'not-a-backup' }}
 */
export function parseBackup(raw) {
  let payload = raw;

  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }

  if (!isPlainObject(payload)) return { ok: false, reason: 'not-a-backup' };

  const todos = readTasks(payload);
  const notes = readNotes(payload);
  if (!todos && !notes) return { ok: false, reason: 'not-a-backup' };

  return { ok: true, todos, notes };
}

/**
 * @param {{ todos: *|null, notes: *|null }} data
 * @returns {string} e.g. '3 tasks and 1 note'
 */
export function describeBackup({ todos, notes }) {
  const taskCount = todos ? todos.todos.length : 0;
  const noteCount = notes ? notes.notes.length : 0;

  return `${countLabel(taskCount, 'task')} and ${countLabel(noteCount, 'note')}`;
}

function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
