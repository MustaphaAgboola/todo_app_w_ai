/**
 * Crash-proof `localStorage` persistence.
 *
 * Browsers throw on storage access in several real situations (Safari private
 * mode, disabled cookies, a full quota, `file://` in some engines), so every
 * call is wrapped and failures degrade to "the app just doesn't persist"
 * instead of breaking the page.
 */

/** Key holding the task state. */
export const STORAGE_KEY = 'stage1-todo-app:v1';

/** Notes live under their own key so the two features evolve independently. */
export const NOTES_STORAGE_KEY = 'stage1-todo-app:notes:v1';

/**
 * @returns {Storage|null} `localStorage` when it is actually usable.
 */
export function getDefaultStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;

    // Probe with a write: some engines expose the object but throw on use.
    const probeKey = `${STORAGE_KEY}:probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Wraps any Storage-like object (or `null`) behind a tiny, never-throwing API.
 *
 * @param {Storage|null} [storage]
 * @param {string} [key]
 */
export function createLocalStorageAdapter(storage = getDefaultStorage(), key = STORAGE_KEY) {
  return {
    key,
    get available() {
      return storage !== null && storage !== undefined;
    },
    /** @returns {string|null} Raw JSON, or `null` when missing/unreadable. */
    read() {
      try {
        const value = storage?.getItem(key);
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    /** @returns {boolean} Whether the value was persisted. */
    write(value) {
      try {
        storage?.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    /** @returns {boolean} Whether the stored value was removed. */
    clear() {
      try {
        storage?.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Reads, parses and sanitises a stored document.
 *
 * The sanitizer is injected so this module stays agnostic of the domain shape
 * (tasks, notes, anything else) and remains reusable and testable on its own.
 *
 * @param {{ read: () => string|null }} adapter
 * @param {(raw: unknown) => unknown} sanitize
 * @returns {*} The sanitised state, or `null` when nothing valid is stored, so
 *   callers can tell "first visit" apart from "empty collection".
 */
export function loadState(adapter, sanitize) {
  const raw = adapter.read();
  if (!raw) return null;

  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Serialises and persists state.
 *
 * @param {{ write: (value: string) => boolean }} adapter
 * @param {*} state
 * @param {(state: *) => unknown} serialize
 * @returns {boolean} Whether the write succeeded.
 */
export function saveState(adapter, state, serialize) {
  try {
    return adapter.write(JSON.stringify(serialize(state)));
  } catch {
    return false;
  }
}
