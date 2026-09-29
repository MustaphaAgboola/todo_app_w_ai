import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTES_SCHEMA_VERSION,
  UNTITLED_NOTE,
  addNote,
  compareNotes,
  countPinned,
  createInitialNotesState,
  isNoteEmpty,
  removeNote,
  sanitizeNotes,
  selectVisibleNotes,
  serializeNotes,
  togglePin,
  updateNote,
} from '../src/notes.js';
import { MAX_BODY_LENGTH } from '../src/shared.js';

/** Deterministic ids so assertions can name exact values. */
function sequentialIds(prefix = 'n') {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

/** Builds a notes state from `[title, body]` pairs. */
function buildNotes(entries, options = {}, idFactory = sequentialIds()) {
  return entries.reduce(
    (state, [title, body]) => addNote(state, { title, body }, { ...options, idFactory }),
    createInitialNotesState(),
  );
}

test('createInitialNotesState starts empty', () => {
  assert.deepEqual(createInitialNotesState(), { notes: [] });
});

test('addNote trims content and applies defaults', () => {
  const state = createInitialNotesState();
  const next = addNote(state, { title: '  Shopping   list ', body: '\n milk \n' }, {
    idFactory: sequentialIds(),
    now: 1000,
  });

  assert.equal(state.notes.length, 0, 'original state is untouched');
  assert.equal(next.notes.length, 1);
  assert.deepEqual(next.notes[0], {
    id: 'n-1',
    title: 'Shopping list',
    body: 'milk',
    pinned: false,
    createdAt: 1000,
    updatedAt: 1000,
  });
});

test('addNote rejects notes with no content at all', () => {
  const state = createInitialNotesState();

  assert.equal(addNote(state, {}), state);
  assert.equal(addNote(state, { title: '   ', body: '\n\n ' }), state);
  assert.equal(addNote(state), state);
});

test('addNote keeps blank lines inside a body but drops noisy whitespace', () => {
  const state = addNote(createInitialNotesState(), {
    body: 'first line   \r\n\r\n\tsecond line\r\n',
  });

  assert.equal(state.notes[0].body, 'first line\n\n\tsecond line');
});

test('addNote caps very long bodies', () => {
  const state = addNote(createInitialNotesState(), { body: 'x'.repeat(MAX_BODY_LENGTH + 500) });
  assert.equal(state.notes[0].body.length, MAX_BODY_LENGTH);
});

test('addNote allows a body-only note and keeps its title empty', () => {
  const state = addNote(createInitialNotesState(), { body: 'just a thought' });

  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].title, '');
  assert.equal(UNTITLED_NOTE, 'Untitled note', 'the UI falls back to this label');
});

test('addNote suffixes colliding ids instead of overwriting', () => {
  const state = buildNotes([['a'], ['b'], ['c']], {}, () => 'same-id');
  assert.deepEqual(
    state.notes.map((note) => note.id),
    ['same-id', 'same-id-2', 'same-id-3'],
  );
});

test('updateNote rewrites title and body and bumps updatedAt', () => {
  const state = buildNotes([['Old', 'Old body']], { now: 100 });
  const next = updateNote(state, 'n-1', { title: 'New', body: 'New body' }, { now: 200 });

  assert.equal(next.notes[0].title, 'New');
  assert.equal(next.notes[0].body, 'New body');
  assert.equal(next.notes[0].updatedAt, 200);
  assert.equal(next.notes[0].createdAt, 100, 'createdAt is preserved');
  assert.deepEqual(state.notes[0], {
    id: 'n-1',
    title: 'Old',
    body: 'Old body',
    pinned: false,
    createdAt: 100,
    updatedAt: 100,
  }, 'original state is untouched');
});

test('updateNote supports partial patches', () => {
  const state = buildNotes([['Keep me', 'Keep this too']]);

  const titleOnly = updateNote(state, 'n-1', { title: 'Renamed' });
  assert.equal(titleOnly.notes[0].title, 'Renamed');
  assert.equal(titleOnly.notes[0].body, 'Keep this too');

  const bodyOnly = updateNote(state, 'n-1', { body: 'Rewritten' });
  assert.equal(bodyOnly.notes[0].title, 'Keep me');
  assert.equal(bodyOnly.notes[0].body, 'Rewritten');
});

test('updateNote refuses to blank a note out and ignores no-ops', () => {
  const state = buildNotes([['Title', 'Body']]);

  assert.equal(updateNote(state, 'n-1', { title: '', body: '   ' }), state, 'never empty itself');
  assert.equal(updateNote(state, 'n-1', { title: 'Title', body: 'Body' }), state, 'unchanged');
  assert.equal(updateNote(state, 'missing', { title: 'x' }), state, 'unknown id');
});

test('updateNote cannot touch the pinned flag', () => {
  const state = buildNotes([['Pinned target']]);
  assert.equal(updateNote(state, 'n-1', { pinned: true }), state, 'pinning is togglePin’s job');
  assert.equal(state.notes[0].pinned, false);
});

test('togglePin flips, can force a value, and reports no-ops', () => {
  const state = buildNotes([['one'], ['two']]);

  const pinned = togglePin(state, 'n-1');
  assert.equal(pinned.notes[0].pinned, true);
  assert.equal(pinned.notes[1].pinned, false);
  assert.equal(pinned.notes[0].updatedAt >= state.notes[0].updatedAt, true);

  assert.equal(togglePin(pinned, 'n-1', true), pinned, 'already pinned');
  assert.equal(togglePin(state, 'missing'), state, 'unknown id');

  const forced = togglePin(state, 'n-2', true);
  assert.equal(forced.notes[1].pinned, true);
});

test('removeNote deletes only the matching note', () => {
  const state = buildNotes([['one'], ['two'], ['three']]);
  const next = removeNote(state, 'n-2');

  assert.deepEqual(next.notes.map((note) => note.title), ['one', 'three']);
  assert.equal(state.notes.length, 3, 'original state is untouched');
  assert.equal(removeNote(state, 'nope'), state);
});

test('selectVisibleNotes sorts pinned first, then most recently updated', () => {
  let state = buildNotes([['first'], ['second'], ['third']], { now: 100 });
  state = updateNote(state, 'n-3', { body: 'touched last' }, { now: 300 });
  state = togglePin(state, 'n-1', true);

  assert.deepEqual(
    selectVisibleNotes(state).map((note) => note.title),
    ['first', 'third', 'second'],
  );
  assert.deepEqual(
    state.notes.map((note) => note.title),
    ['first', 'second', 'third'],
    'the stored order is never mutated',
  );
});

test('compareNotes is a stable comparator over equal timestamps', () => {
  const a = { pinned: false, updatedAt: 5 };
  const b = { pinned: false, updatedAt: 5 };

  assert.equal(compareNotes(a, b), 0);
  assert.equal(compareNotes({ pinned: true, updatedAt: 1 }, { pinned: false, updatedAt: 9 }), -1);
  assert.equal(compareNotes({ pinned: false, updatedAt: 1 }, { pinned: true, updatedAt: 9 }), 1);
  assert.equal(compareNotes({ pinned: false, updatedAt: 9 }, { pinned: false, updatedAt: 1 }), -8);
});

test('selectVisibleNotes searches titles and bodies, case-insensitively', () => {
  const state = buildNotes([
    ['Shopping list', 'milk, eggs'],
    ['Ideas', 'Build a SHOPPING cart widget'],
    ['Boring', 'nothing to see'],
  ]);

  assert.deepEqual(
    selectVisibleNotes(state, 'shopping').map((note) => note.title),
    ['Shopping list', 'Ideas'],
  );
  assert.deepEqual(selectVisibleNotes(state, 'EGGS').map((note) => note.title), ['Shopping list']);
  assert.deepEqual(selectVisibleNotes(state, '  ideas  ').map((note) => note.title), ['Ideas']);
  assert.deepEqual(selectVisibleNotes(state, 'zzz'), []);
});

test('selectVisibleNotes with a blank query matches everything', () => {
  const state = buildNotes([['a'], ['b']]);

  for (const query of ['', '   ', undefined, null]) {
    assert.equal(selectVisibleNotes(state, query).length, 2, `query: ${String(query)}`);
  }
});

test('countPinned counts only pinned notes', () => {
  const state = togglePin(buildNotes([['a'], ['b'], ['c']]), 'n-2', true);

  assert.equal(countPinned(state), 1);
  assert.equal(countPinned(createInitialNotesState()), 0);
});

test('isNoteEmpty reports whether there is any content at all', () => {
  assert.equal(isNoteEmpty({ title: '', body: '   ' }), true);
  assert.equal(isNoteEmpty({}), true);
  assert.equal(isNoteEmpty(undefined), true);
  assert.equal(isNoteEmpty({ title: 'x' }), false);
  assert.equal(isNoteEmpty({ body: 'x' }), false);
});

test('sanitizeNotes drops invalid notes and repairs the rest', () => {
  const state = sanitizeNotes({
    notes: [
      { id: 'a', title: '  Keep  me ', body: 'line\r\nline', pinned: true, createdAt: 10 },
      { id: 'a', title: 'duplicate id' },
      { id: 'b', title: '  ', body: '  ' },
      { id: '', title: 'no id' },
      { title: 'missing id' },
      { id: 'c', body: 'body only' },
      { id: 'd', title: 'flagged', pinned: 'yes' },
      'not an object',
      null,
    ],
  });

  assert.deepEqual(
    state.notes.map((note) => note.id),
    ['a', 'c', 'd'],
  );
  assert.equal(state.notes[0].title, 'Keep me');
  assert.equal(state.notes[0].body, 'line\nline');
  assert.equal(state.notes[0].pinned, true);
  assert.equal(state.notes[0].updatedAt, 10, 'updatedAt falls back to createdAt');
  assert.equal(state.notes[1].title, '', 'body-only notes survive');
  assert.equal(state.notes[2].pinned, false, 'non-boolean pinned is coerced');
});

test('sanitizeNotes falls back to a clean state for garbage input', () => {
  for (const garbage of [null, undefined, 42, 'nope', [], { notes: 'not-an-array' }]) {
    assert.deepEqual(sanitizeNotes(garbage), createInitialNotesState());
  }
});

test('serializeNotes round-trips through sanitizeNotes', () => {
  const state = togglePin(buildNotes([['one', 'body'], ['two']]), 'n-2', true);
  const snapshot = serializeNotes(state);

  assert.equal(snapshot.version, NOTES_SCHEMA_VERSION);
  assert.deepEqual(sanitizeNotes(JSON.parse(JSON.stringify(snapshot))), state);
});
