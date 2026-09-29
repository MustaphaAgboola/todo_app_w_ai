/**
 * Framework-agnostic to-do state logic.
 *
 * Every exported reducer is pure: it returns a brand new state object (or the
 * very same reference when nothing changed) and never mutates its input.
 * Rendering lives in `app.js` so this module can be unit tested with plain Node.
 *
 * @typedef {Object} Todo
 * @property {string}  id         Unique identifier.
 * @property {string}  title      Normalised, non-empty title.
 * @property {boolean} completed  Completion flag.
 * @property {number}  createdAt  Epoch milliseconds.
 * @property {number}  updatedAt  Epoch milliseconds.
 *
 * @typedef {Object} State
 * @property {Todo[]} todos
 * @property {string} filter  One of the FILTERS values.
 */

import {
  defaultIdFactory,
  isPlainObject,
  normalizeTitle,
  resolveId,
  resolveTimestamp,
} from './shared.js';

// Re-exported so existing consumers keep importing them from the task store.
export { MAX_TITLE_LENGTH, defaultIdFactory, normalizeTitle } from './shared.js';

export const FILTERS = Object.freeze({
  ALL: 'all',
  ACTIVE: 'active',
  COMPLETED: 'completed',
});

const FILTER_VALUES = Object.freeze(Object.values(FILTERS));

/** Bumped whenever the persisted shape changes so old data can be migrated. */
export const SCHEMA_VERSION = 1;

/**
 * @returns {State} A brand new, empty state.
 */
export function createInitialState() {
  return { todos: [], filter: FILTERS.ALL };
}

/**
 * Appends a new, active todo. Blank titles are rejected (state returned as-is).
 *
 * @param {State} state
 * @param {string} title
 * @param {{ now?: number, idFactory?: () => string }} [options]
 * @returns {State}
 */
export function addTodo(state, title, options = {}) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) return state;

  const now = resolveTimestamp(options.now);
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;

  return {
    ...state,
    todos: [
      ...state.todos,
      {
        id: resolveId(idFactory, state.todos),
        title: cleanTitle,
        completed: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

/**
 * Renames a todo. Blank titles and unknown ids are rejected.
 *
 * @param {State} state
 * @param {string} id
 * @param {string} title
 * @param {{ now?: number }} [options]
 * @returns {State}
 */
export function updateTodo(state, id, title, options = {}) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) return state;

  const now = resolveTimestamp(options.now);
  let changed = false;

  const todos = state.todos.map((todo) => {
    if (todo.id !== id || todo.title === cleanTitle) return todo;
    changed = true;
    return { ...todo, title: cleanTitle, updatedAt: now };
  });

  return changed ? { ...state, todos } : state;
}

/**
 * Flips a todo's completion flag, or forces it when `completed` is a boolean.
 *
 * @param {State} state
 * @param {string} id
 * @param {boolean} [completed]
 * @param {{ now?: number }} [options]
 * @returns {State}
 */
export function toggleTodo(state, id, completed, options = {}) {
  const now = resolveTimestamp(options.now);
  let changed = false;

  const todos = state.todos.map((todo) => {
    if (todo.id !== id) return todo;

    const nextCompleted = typeof completed === 'boolean' ? completed : !todo.completed;
    if (nextCompleted === todo.completed) return todo;

    changed = true;
    return { ...todo, completed: nextCompleted, updatedAt: now };
  });

  return changed ? { ...state, todos } : state;
}

/**
 * @param {State} state
 * @param {string} id
 * @returns {State}
 */
export function removeTodo(state, id) {
  const todos = state.todos.filter((todo) => todo.id !== id);
  return todos.length === state.todos.length ? state : { ...state, todos };
}

/**
 * Marks every todo as complete/incomplete in one go ("select all").
 *
 * @param {State} state
 * @param {boolean} completed
 * @param {{ now?: number }} [options]
 * @returns {State}
 */
export function toggleAll(state, completed, options = {}) {
  const target = Boolean(completed);
  if (!state.todos.some((todo) => todo.completed !== target)) return state;

  const now = resolveTimestamp(options.now);
  return {
    ...state,
    todos: state.todos.map((todo) =>
      todo.completed === target ? todo : { ...todo, completed: target, updatedAt: now },
    ),
  };
}

/**
 * Removes every completed todo.
 * @param {State} state
 * @returns {State}
 */
export function clearCompleted(state) {
  if (!state.todos.some((todo) => todo.completed)) return state;
  return { ...state, todos: state.todos.filter((todo) => !todo.completed) };
}

/**
 * Switches the active filter. Unknown filters are ignored.
 *
 * @param {State} state
 * @param {string} filter
 * @returns {State}
 */
export function setFilter(state, filter) {
  if (!FILTER_VALUES.includes(filter) || state.filter === filter) return state;
  return { ...state, filter };
}

/**
 * @param {State} state
 * @returns {Todo[]} The todos matching the active filter.
 */
export function selectVisibleTodos(state) {
  switch (state.filter) {
    case FILTERS.ACTIVE:
      return state.todos.filter((todo) => !todo.completed);
    case FILTERS.COMPLETED:
      return state.todos.filter((todo) => todo.completed);
    default:
      return state.todos;
  }
}

/** @param {State} state @returns {number} */
export function countActive(state) {
  return state.todos.reduce((total, todo) => (todo.completed ? total : total + 1), 0);
}

/** @param {State} state @returns {number} */
export function countCompleted(state) {
  return state.todos.length - countActive(state);
}

/**
 * Turns untrusted input (localStorage, a `storage` event, an imported file) into
 * a valid State. Invalid todos are dropped rather than crashing the app, and ids
 * are de-duplicated so `data-id` lookups stay unambiguous.
 *
 * @param {unknown} raw
 * @returns {State}
 */
export function sanitizeState(raw) {
  const state = createInitialState();
  if (!isPlainObject(raw)) return state;

  const seenIds = new Set();
  const rawTodos = Array.isArray(raw.todos) ? raw.todos : [];

  for (const candidate of rawTodos) {
    if (!isPlainObject(candidate)) continue;

    const title = normalizeTitle(candidate.title);
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!id || !title || seenIds.has(id)) continue;

    seenIds.add(id);
    const createdAt = Number.isFinite(candidate.createdAt) ? candidate.createdAt : 0;

    state.todos.push({
      id,
      title,
      completed: candidate.completed === true,
      createdAt,
      updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : createdAt,
    });
  }

  if (FILTER_VALUES.includes(raw.filter)) state.filter = raw.filter;
  return state;
}

/**
 * @param {State} state
 * @returns {{ version: number, todos: Todo[], filter: string }} A serialisable snapshot.
 */
export function serializeState(state) {
  return {
    version: SCHEMA_VERSION,
    todos: state.todos.map((todo) => ({ ...todo })),
    filter: state.filter,
  };
}
