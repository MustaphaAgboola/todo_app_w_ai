import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FILTERS,
  MAX_TITLE_LENGTH,
  SCHEMA_VERSION,
  addTodo,
  clearCompleted,
  countActive,
  countCompleted,
  createInitialState,
  normalizeTitle,
  removeTodo,
  sanitizeState,
  selectVisibleTodos,
  serializeState,
  setFilter,
  toggleAll,
  toggleTodo,
  updateTodo,
} from '../src/store.js';

/** A deterministic id factory so assertions can name exact ids. */
function sequentialIds(prefix = 'id') {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

/** Builds a state from titles using deterministic ids. */
function buildState(titles, options = {}, idFactory = sequentialIds()) {
  return titles.reduce((state, title) => addTodo(state, title, { ...options, idFactory }), createInitialState());
}

test('createInitialState starts empty and on the ALL filter', () => {
  assert.deepEqual(createInitialState(), { todos: [], filter: FILTERS.ALL });
});

test('normalizeTitle trims, collapses whitespace and clamps length', () => {
  assert.equal(normalizeTitle('  buy   milk  '), 'buy milk');
  assert.equal(normalizeTitle('tabs\tand\nnewlines'), 'tabs and newlines');
  assert.equal(normalizeTitle('   '), '');
  assert.equal(normalizeTitle(undefined), '');
  assert.equal(normalizeTitle(42), '');
  assert.equal(normalizeTitle('x'.repeat(500)).length, MAX_TITLE_LENGTH);
});

test('addTodo appends an active todo without mutating the previous state', () => {
  const state = createInitialState();
  const next = addTodo(state, '  Write   tests ', { idFactory: sequentialIds(), now: 1000 });

  assert.equal(state.todos.length, 0, 'original state is untouched');
  assert.notEqual(state, next, 'a new state object is returned');
  assert.equal(next.todos.length, 1);
  assert.deepEqual(next.todos[0], {
    id: 'id-1',
    title: 'Write tests',
    completed: false,
    createdAt: 1000,
    updatedAt: 1000,
  });
});

test('addTodo rejects blank titles by returning the same state reference', () => {
  const state = createInitialState();
  assert.equal(addTodo(state, ''), state);
  assert.equal(addTodo(state, '    '), state);
  assert.equal(addTodo(state, null), state);
});

test('addTodo suffixes colliding ids instead of overwriting', () => {
  const state = buildState(['first', 'second', 'third'], {}, () => 'same-id');
  assert.deepEqual(
    state.todos.map((todo) => todo.id),
    ['same-id', 'same-id-2', 'same-id-3'],
  );
});

test('updateTodo renames a todo and bumps updatedAt', () => {
  const state = buildState(['old title'], {}, sequentialIds());
  const next = updateTodo(state, 'id-1', '  new   title ', { now: 2000 });

  assert.equal(next.todos[0].title, 'new title');
  assert.equal(next.todos[0].updatedAt, 2000);
  assert.equal(next.todos[0].createdAt, state.todos[0].createdAt);
  assert.equal(state.todos[0].title, 'old title', 'original state is untouched');
});

test('updateTodo ignores blank titles, unknown ids and no-op renames', () => {
  const state = buildState(['title']);

  assert.equal(updateTodo(state, 'id-1', '   '), state);
  assert.equal(updateTodo(state, 'missing', 'anything'), state);
  assert.equal(updateTodo(state, 'id-1', 'title'), state, 'same title is a no-op');
});

test('toggleTodo flips completion, or forces an explicit value', () => {
  const state = buildState(['one', 'two']);
  const toggled = toggleTodo(state, 'id-1');
  assert.equal(toggled.todos[0].completed, true);
  assert.equal(toggled.todos[1].completed, false);

  const forced = toggleTodo(toggled, 'id-1', false, { now: 5 });
  assert.equal(forced.todos[0].completed, false);
  assert.equal(forced.todos[0].updatedAt, 5);

  assert.equal(toggleTodo(forced, 'id-1', false), forced, 'already false is a no-op');
  assert.equal(toggleTodo(state, 'missing'), state);
});

test('removeTodo deletes the matching todo only', () => {
  const state = buildState(['one', 'two', 'three']);
  const next = removeTodo(state, 'id-2');

  assert.deepEqual(next.todos.map((todo) => todo.title), ['one', 'three']);
  assert.equal(state.todos.length, 3, 'original state is untouched');
  assert.equal(removeTodo(state, 'nope'), state, 'unknown id is a no-op');
});

test('toggleAll marks every todo at once and is a no-op when already aligned', () => {
  const state = buildState(['one', 'two']);
  const allDone = toggleAll(state, true, { now: 7 });

  assert.equal(countCompleted(allDone), 2);
  assert.equal(allDone.todos[0].updatedAt, 7);
  assert.equal(toggleAll(allDone, true), allDone, 'already all complete is a no-op');

  const cleared = toggleAll(allDone, false);
  assert.equal(countActive(cleared), 2);
});

test('clearCompleted keeps only the active todos', () => {
  const state = toggleTodo(buildState(['keep', 'drop']), 'id-2');
  const next = clearCompleted(state);

  assert.deepEqual(next.todos.map((todo) => todo.title), ['keep']);
  assert.equal(clearCompleted(next), next, 'nothing completed is a no-op');
});

test('setFilter only accepts known filters', () => {
  const state = createInitialState();

  assert.equal(setFilter(state, FILTERS.COMPLETED).filter, FILTERS.COMPLETED);
  assert.equal(setFilter(state, 'bogus'), state);
  assert.equal(setFilter(state, FILTERS.ALL), state, 'same filter is a no-op');
});

test('selectVisibleTodos honours the active filter', () => {
  const state = toggleTodo(buildState(['a', 'b', 'c']), 'id-2');

  assert.equal(selectVisibleTodos(state).length, 3, 'ALL shows everything');
  assert.deepEqual(
    selectVisibleTodos(setFilter(state, FILTERS.ACTIVE)).map((todo) => todo.title),
    ['a', 'c'],
  );
  assert.deepEqual(
    selectVisibleTodos(setFilter(state, FILTERS.COMPLETED)).map((todo) => todo.title),
    ['b'],
  );
});

test('countActive and countCompleted partition the todo list', () => {
  const state = toggleTodo(buildState(['a', 'b', 'c']), 'id-1');

  assert.equal(countActive(state), 2);
  assert.equal(countCompleted(state), 1);
  assert.equal(countActive(state) + countCompleted(state), state.todos.length);
  assert.equal(countActive(createInitialState()), 0);
});

test('sanitizeState repairs untrusted input and drops invalid todos', () => {
  const state = sanitizeState({
    filter: 'completed',
    todos: [
      { id: 'a', title: '  keep  me ', completed: true, createdAt: 10 },
      { id: 'a', title: 'duplicate id', completed: false },
      { id: 'b', title: '   ', completed: false },
      { id: '', title: 'no id', completed: false },
      { title: 'missing id', completed: false },
      'not an object',
      null,
      { id: 'c', title: 'defaults applied', completed: 'yes' },
    ],
  });

  assert.equal(state.filter, FILTERS.COMPLETED);
  assert.deepEqual(
    state.todos.map((todo) => todo.id),
    ['a', 'c'],
  );
  assert.equal(state.todos[0].title, 'keep me');
  assert.equal(state.todos[0].completed, true);
  assert.equal(state.todos[0].updatedAt, 10, 'updatedAt falls back to createdAt');
  assert.equal(state.todos[1].completed, false, 'truthy non-boolean is coerced to false');
});

test('sanitizeState falls back to a clean state for garbage input', () => {
  for (const garbage of [null, undefined, 42, 'nope', [], { todos: 'not-an-array' }]) {
    assert.deepEqual(sanitizeState(garbage), createInitialState());
  }
  assert.equal(sanitizeState({ filter: 'bogus' }).filter, FILTERS.ALL);
});

test('serializeState round-trips through sanitizeState', () => {
  const state = setFilter(toggleTodo(buildState(['one', 'two']), 'id-1'), FILTERS.ACTIVE);
  const snapshot = serializeState(state);

  assert.equal(snapshot.version, SCHEMA_VERSION);
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(snapshot))), state);
});
