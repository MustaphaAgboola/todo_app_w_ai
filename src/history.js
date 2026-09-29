/**
 * A bounded, pure undo stack shared by both views.
 *
 * Only *destructive* actions are recorded — deleting a task or note, clearing
 * completed tasks, importing a backup — because those are the changes a user
 * cannot trivially reverse by hand. Everything else (ticking a task, renaming)
 * is one click to undo already, and recording every keystroke would make the
 * stack both huge and unpredictable.
 *
 * Every function is pure and returns the same reference when nothing changed,
 * matching the stores.
 *
 * @typedef {Object} HistoryEntry
 * @property {string} message  Shown to the user, e.g. 'Deleted "Milk"'.
 * @property {*}      [todos]  Task snapshot to restore, when tasks changed.
 * @property {*}      [notes]  Notes snapshot to restore, when notes changed.
 */

/** Oldest entries are dropped once this many have been recorded. */
export const MAX_HISTORY = 25;

/**
 * @param {number} [limit] Maximum number of entries to keep.
 * @returns {{ entries: HistoryEntry[], limit: number }}
 */
export function createHistory(limit = MAX_HISTORY) {
  const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : MAX_HISTORY;
  return { entries: [], limit: safeLimit };
}

/**
 * @param {unknown} entry
 * @returns {boolean} Whether the entry carries a message and something to restore.
 */
export function isUndoable(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.message !== 'string' || entry.message === '') return false;
  return entry.todos !== undefined || entry.notes !== undefined;
}

/**
 * Records an entry, dropping the oldest ones once the limit is reached.
 * Invalid entries are ignored, and a zero limit disables recording entirely.
 *
 * @param {{ entries: HistoryEntry[], limit: number }} history
 * @param {HistoryEntry} entry
 * @returns {{ entries: HistoryEntry[], limit: number }}
 */
export function recordEntry(history, entry) {
  if (history.limit === 0 || !isUndoable(entry)) return history;

  const entries = [...history.entries, entry];
  return {
    ...history,
    entries: entries.length > history.limit ? entries.slice(entries.length - history.limit) : entries,
  };
}

/**
 * @param {{ entries: HistoryEntry[] }} history
 * @returns {HistoryEntry|null} The most recent entry, or `null` when empty.
 */
export function latestEntry(history) {
  return history.entries.at(-1) ?? null;
}

/**
 * @param {{ entries: HistoryEntry[], limit: number }} history
 * @returns {{ entries: HistoryEntry[], limit: number }} Without the newest entry.
 */
export function dropLatestEntry(history) {
  if (history.entries.length === 0) return history;
  return { ...history, entries: history.entries.slice(0, -1) };
}

/** @param {{ entries: HistoryEntry[] }} history @returns {number} */
export function historySize(history) {
  return history.entries.length;
}

/**
 * @param {{ entries: HistoryEntry[], limit: number }} history
 * @returns {{ entries: HistoryEntry[], limit: number }} An empty stack.
 */
export function clearHistory(history) {
  return history.entries.length === 0 ? history : { ...history, entries: [] };
}
