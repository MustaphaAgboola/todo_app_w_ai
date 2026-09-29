import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  buildBackup,
  describeBackup,
  parseBackup,
} from '../src/backup.js';
import { addNote, createInitialNotesState, serializeNotes, togglePin } from '../src/notes.js';
import { FILTERS, addTodo, createInitialState, serializeState, setFilter, toggleTodo } from '../src/store.js';

/** A representative task state: two tasks, one of them completed, filtered. */
function sampleTasks() {
  let state = addTodo(addTodo(createInitialState(), 'buy milk'), 'walk dog');
  state = toggleTodo(state, state.todos[0].id);
  return setFilter(state, FILTERS.ACTIVE);
}

/** A representative notes state: a titled note (pinned) and a body-only note. */
function sampleNotes() {
  let state = addNote(addNote(createInitialNotesState(), { title: 'Groceries', body: 'milk\neggs' }), {
    body: 'a passing thought',
  });
  return togglePin(state, state.notes[0].id);
}

// Built once: ids are random, so a second call would produce a different state.
const TASKS = sampleTasks();
const NOTES = sampleNotes();

test('buildBackup writes a versioned, self-describing envelope', () => {
  const backup = buildBackup({ todos: TASKS, notes: NOTES }, { exportedAt: 1000 });

  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.exportedAt, 1000);
  assert.deepEqual(backup.todos, serializeState(TASKS));
  assert.deepEqual(backup.notes, serializeNotes(NOTES));
});

test('buildBackup timestamps the export when no time is given', () => {
  const before = Date.now();
  const backup = buildBackup({ todos: createInitialState(), notes: createInitialNotesState() });

  assert.ok(backup.exportedAt >= before);
  assert.ok(backup.exportedAt <= Date.now());
});

test('backupFileName is dated, and never throws on a nonsense time', () => {
  const stamp = Date.UTC(2026, 8, 29, 12, 0, 0);

  assert.equal(backupFileName(stamp), 'tasks-and-notes-2026-09-29.json');
  assert.equal(backupFileName(NaN), 'tasks-and-notes.json');
  assert.equal(backupFileName(Infinity), 'tasks-and-notes.json');
});

test('an exported backup imports back into the same state', () => {
  const file = JSON.stringify(buildBackup({ todos: TASKS, notes: NOTES }, { exportedAt: 42 }));
  const parsed = parseBackup(file);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.todos, TASKS, 'tasks survive the round trip');
  assert.deepEqual(parsed.notes, NOTES, 'notes survive the round trip');
});

test('a document holding only tasks or only notes is accepted', () => {
  const tasksOnly = parseBackup(JSON.stringify(serializeState(TASKS)));
  assert.equal(tasksOnly.ok, true, 'a raw task document is importable');
  assert.deepEqual(tasksOnly.todos, TASKS);
  assert.equal(tasksOnly.notes, null, 'nothing to import for notes');

  const notesOnly = parseBackup({ notes: serializeNotes(NOTES) });
  assert.equal(notesOnly.ok, true);
  assert.deepEqual(notesOnly.notes, NOTES);
  assert.equal(notesOnly.todos, null);
});

test('imported data is treated as untrusted and sanitised', () => {
  const parsed = parseBackup(
    JSON.stringify({
      format: BACKUP_FORMAT,
      version: 99,
      todos: {
        filter: 'not-a-filter',
        todos: [{ id: 'a', title: '  keep  ' }, { id: 'a', title: 'dupe' }, { nope: true }],
      },
      notes: { notes: [{ id: 'b', title: '', body: '' }, { id: 'c', body: 'fine' }] },
    }),
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.todos.filter, FILTERS.ALL, 'an unknown filter falls back to ALL');
  assert.equal(parsed.todos.todos.length, 1);
  assert.equal(parsed.todos.todos[0].title, 'keep');
  assert.deepEqual(parsed.notes.notes.map((note) => note.id), ['c'], 'empty notes are dropped');
});

test('parseBackup reports why a file was rejected', () => {
  assert.deepEqual(parseBackup('{not json'), { ok: false, reason: 'invalid-json' });
  assert.deepEqual(parseBackup('{"a":1'), { ok: false, reason: 'invalid-json' });

  for (const value of ['null', '42', '"text"', '[1,2]', '{}', '{"todos":"nope"}', '{"format":"x"}']) {
    assert.deepEqual(parseBackup(value), { ok: false, reason: 'not-a-backup' }, `value: ${value}`);
  }

  for (const value of [null, undefined, 42, []]) {
    assert.equal(parseBackup(value).ok, false, `${String(value)} is not a backup`);
  }
});

test('describeBackup reports both halves with correct plurals', () => {
  assert.equal(describeBackup({ todos: TASKS, notes: NOTES }), '2 tasks and 2 notes');
  assert.equal(
    describeBackup({ todos: createInitialState(), notes: createInitialNotesState() }),
    '0 tasks and 0 notes',
  );
  assert.equal(describeBackup({ todos: { todos: [{}] }, notes: { notes: [{}] } }), '1 task and 1 note');
  assert.equal(describeBackup({ todos: { todos: [{}] }, notes: null }), '1 task and 0 notes');
  assert.equal(describeBackup({ todos: null, notes: { notes: [{}] } }), '0 tasks and 1 note');
});
