import test from 'node:test';
import assert from 'node:assert/strict';

import { FILTERS, addTodo, createInitialState, sanitizeState, serializeState } from '../src/store.js';
import { addNote, createInitialNotesState, sanitizeNotes, serializeNotes } from '../src/notes.js';
import {
  NOTES_STORAGE_KEY,
  STORAGE_KEY,
  createLocalStorageAdapter,
  loadState,
  saveState,
} from '../src/storage.js';

/** Minimal in-memory `Storage` stand-in with toggleable failure modes. */
function createFakeStorage({ failOnWrite = false, failOnRead = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(key) {
      if (failOnRead) throw new Error('read blocked');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (failOnWrite) throw new Error('quota exceeded');
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('adapter reports availability and round-trips a value', () => {
  const storage = createFakeStorage();
  const adapter = createLocalStorageAdapter(storage);

  assert.equal(adapter.available, true);
  assert.equal(adapter.read(), null, 'nothing stored yet');

  assert.equal(adapter.write('{"hello":true}'), true);
  assert.equal(adapter.read(), '{"hello":true}');
  assert.equal(storage.map.get(STORAGE_KEY), '{"hello":true}', 'uses the versioned key');

  assert.equal(adapter.clear(), true);
  assert.equal(adapter.read(), null);
});

test('adapter with no storage available degrades instead of throwing', () => {
  for (const missing of [null, undefined]) {
    const adapter = createLocalStorageAdapter(missing);
    assert.equal(adapter.available, false);
    assert.equal(adapter.read(), null);
    assert.equal(adapter.write('anything'), true, 'optional chaining keeps writes inert');
    assert.equal(adapter.clear(), true);
  }
});

test('adapter survives storage that throws (Safari private mode / quota)', () => {
  const adapter = createLocalStorageAdapter(createFakeStorage({ failOnWrite: true, failOnRead: true }));

  assert.equal(adapter.read(), null, 'a throwing getItem is swallowed');
  assert.equal(adapter.write('anything'), false, 'a rejected write is reported as not persisted');
  assert.equal(adapter.clear(), true, 'removeItem on the fake cannot fail');
});

test('loadState returns null on a first visit or unreadable storage', () => {
  assert.equal(loadState(createLocalStorageAdapter(createFakeStorage()), sanitizeState), null);

  const broken = createLocalStorageAdapter(createFakeStorage({ failOnRead: true }));
  assert.equal(loadState(broken, sanitizeState), null);
});

test('loadState recovers from corrupted JSON instead of crashing', () => {
  const storage = createFakeStorage();
  storage.setItem(STORAGE_KEY, '{not valid json');

  assert.equal(loadState(createLocalStorageAdapter(storage), sanitizeState), null);
});

test('saveState then loadState preserves todos and the active filter', () => {
  const adapter = createLocalStorageAdapter(createFakeStorage());
  const state = { ...addTodo(addTodo(createInitialState(), 'buy milk'), 'walk dog'), filter: FILTERS.ACTIVE };

  assert.equal(saveState(adapter, state, serializeState), true);
  assert.deepEqual(loadState(adapter, sanitizeState), state);
  assert.match(String(adapter.read()), /"version":1/u, 'the snapshot is versioned');
});

test('loadState sanitises stored data that has been tampered with', () => {
  const storage = createFakeStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      filter: 'not-a-filter',
      todos: [{ id: 'x', title: ' valid  ' }, { id: 'x', title: 'dupe' }, { nope: true }],
    }),
  );

  const state = loadState(createLocalStorageAdapter(storage), sanitizeState);

  assert.equal(state.filter, FILTERS.ALL, 'invalid filter falls back to ALL');
  assert.equal(state.todos.length, 1);
  assert.equal(state.todos[0].title, 'valid');
});

test('saveState reports failure when the write is rejected', () => {
  const adapter = createLocalStorageAdapter(createFakeStorage({ failOnWrite: true }));

  assert.equal(saveState(adapter, createInitialState(), serializeState), false);
  assert.equal(saveState(adapter, createInitialNotesState(), serializeNotes), false);
});

test('the persistence helpers are domain-agnostic', () => {
  const adapter = createLocalStorageAdapter(createFakeStorage());
  const sanitize = (raw) => ({ seen: raw });
  const serialize = (state) => ({ payload: state });

  assert.equal(saveState(adapter, { hello: 'world' }, serialize), true);
  assert.deepEqual(loadState(adapter, sanitize), { seen: { payload: { hello: 'world' } } });
  assert.ok(!String(adapter.read()).includes('todos'), 'storage.js knows nothing about tasks');
});

test('notes round-trip through their own key and sanitizer', () => {
  const shared = createFakeStorage();
  const tasks = createLocalStorageAdapter(shared);
  const notes = createLocalStorageAdapter(shared, NOTES_STORAGE_KEY);

  const state = addNote(addNote(createInitialNotesState(), { title: 'Pinned' }), { body: 'body only' });
  assert.equal(saveState(notes, state, serializeNotes), true);

  assert.deepEqual(loadState(notes, sanitizeNotes), state);
  assert.equal(loadState(tasks, sanitizeState), null, 'the task key is untouched');
  assert.notEqual(NOTES_STORAGE_KEY, STORAGE_KEY);
  assert.ok(shared.map.has(NOTES_STORAGE_KEY));
});

test('a notes document written by a newer version is still readable', () => {
  const storage = createFakeStorage();
  storage.setItem(NOTES_STORAGE_KEY, JSON.stringify({ version: 99, notes: [{ id: 'x', title: 'future' }] }));

  const state = loadState(createLocalStorageAdapter(storage, NOTES_STORAGE_KEY), sanitizeNotes);
  assert.equal(state.notes[0].title, 'future');
});
