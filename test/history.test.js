import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_HISTORY,
  clearHistory,
  createHistory,
  dropLatestEntry,
  historySize,
  isUndoable,
  latestEntry,
  recordEntry,
} from '../src/history.js';

const entry = (message, key = 'todos') => ({ message, [key]: { snapshot: message } });

test('createHistory starts empty and validates the limit', () => {
  assert.deepEqual(createHistory(3), { entries: [], limit: 3 });
  assert.equal(createHistory().limit, MAX_HISTORY);
  assert.equal(createHistory(0).limit, 0, 'a zero limit is meaningful: undo disabled');

  for (const invalid of [-1, 1.5, '5', null, NaN]) {
    assert.equal(createHistory(invalid).limit, MAX_HISTORY, `limit: ${String(invalid)}`);
  }
});

test('isUndoable requires a message and something to restore', () => {
  assert.equal(isUndoable(entry('Deleted "Milk"')), true);
  assert.equal(isUndoable(entry('Deleted "Milk"', 'notes')), true);
  assert.equal(isUndoable({ message: 'Imported', todos: {}, notes: {} }), true);
  assert.equal(isUndoable({ message: '' }), false, 'an empty message is useless in the UI');
  assert.equal(isUndoable({ message: 'x' }), false, 'nothing to restore');
  assert.equal(isUndoable({ todos: {} }), false, 'no message');

  for (const value of [null, undefined, 'x', 42, []]) {
    assert.equal(isUndoable(value), false, `${String(value)} is not an entry`);
  }
});

test('recordEntry appends without mutating the previous history', () => {
  const history = createHistory(5);
  const next = recordEntry(history, entry('first'));

  assert.equal(historySize(history), 0, 'the original is untouched');
  assert.notEqual(next, history);
  assert.equal(next.limit, 5, 'the limit is carried over');
  assert.equal(historySize(next), 1);
  assert.equal(latestEntry(next).message, 'first');
});

test('recordEntry ignores entries that could not be undone', () => {
  const history = recordEntry(createHistory(5), entry('kept'));

  assert.equal(recordEntry(history, { message: 'nothing to restore' }), history);
  assert.equal(recordEntry(history, null), history);
  assert.equal(historySize(history), 1);
});

test('recordEntry keeps only the newest entries once the limit is reached', () => {
  let history = createHistory(3);
  for (const message of ['one', 'two', 'three', 'four', 'five']) {
    history = recordEntry(history, entry(message));
  }

  assert.equal(historySize(history), 3);
  assert.deepEqual(history.entries.map((item) => item.message), ['three', 'four', 'five']);
});

test('a zero limit disables recording', () => {
  const history = createHistory(0);

  assert.equal(recordEntry(history, entry('nope')), history);
  assert.equal(historySize(history), 0);
});

test('latestEntry and dropLatestEntry behave like a stack', () => {
  const empty = createHistory();
  assert.equal(latestEntry(empty), null);
  assert.equal(dropLatestEntry(empty), empty, 'dropping from an empty stack is a no-op');

  let history = recordEntry(recordEntry(createHistory(), entry('first')), entry('second'));
  assert.equal(latestEntry(history).message, 'second');

  history = dropLatestEntry(history);
  assert.equal(latestEntry(history).message, 'first');
  assert.equal(historySize(history), 1);
});

test('clearHistory empties the stack but keeps the limit', () => {
  const history = recordEntry(createHistory(7), entry('gone'));
  const cleared = clearHistory(history);

  assert.equal(historySize(cleared), 0);
  assert.equal(cleared.limit, 7);
  assert.equal(clearHistory(cleared), cleared, 'already empty is a no-op');
});

test('an entry can carry both snapshots at once, as an import does', () => {
  const both = { message: 'Imported backup', todos: { todos: [] }, notes: { notes: [{ id: 'n' }] } };
  const history = recordEntry(createHistory(), both);

  assert.equal(isUndoable(both), true);
  assert.equal(latestEntry(history).todos.todos.length, 0);
  assert.equal(latestEntry(history).notes.notes.length, 1);
});
