import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  defaultIdFactory,
  isPlainObject,
  normalizeBody,
  normalizeTitle,
  resolveId,
  resolveTimestamp,
} from '../src/shared.js';

test('the length limits are sane', () => {
  for (const limit of [MAX_TITLE_LENGTH, MAX_BODY_LENGTH]) {
    assert.equal(Number.isInteger(limit), true);
    assert.ok(limit > 0);
  }
  assert.ok(MAX_BODY_LENGTH > MAX_TITLE_LENGTH, 'a note body holds more than a title');
});

test('normalizeBody unifies line endings and strips noisy whitespace', () => {
  assert.equal(normalizeBody('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(normalizeBody('  spaced  \n\tand tabs\t \n'), 'spaced\n\tand tabs');
  assert.equal(normalizeBody('\n\n  \n'), '');
  assert.equal(normalizeBody(42), '');
  assert.equal(normalizeBody(undefined), '');
  assert.equal(normalizeBody('x'.repeat(MAX_BODY_LENGTH + 10)).length, MAX_BODY_LENGTH);
});

test('normalizeTitle is re-exported from the task store for existing callers', async () => {
  const { normalizeTitle: fromStore } = await import('../src/store.js');
  assert.equal(fromStore, normalizeTitle, 'both modules share one implementation');
});

test('isPlainObject rejects everything that is not an object literal', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject(Object.create(null)), true);

  for (const value of [null, undefined, 1, 'x', true, [], [{}], new Date(), new Map(), () => {}]) {
    assert.equal(isPlainObject(value), false, `${String(value)} is not a plain object`);
  }
});

test('resolveTimestamp keeps finite numbers and fills in the rest', () => {
  assert.equal(resolveTimestamp(0), 0);
  assert.equal(resolveTimestamp(1234), 1234);

  const before = Date.now();
  for (const value of [undefined, null, NaN, Infinity, '1234']) {
    const resolved = resolveTimestamp(value);
    assert.equal(Number.isFinite(resolved), true, `${String(value)} resolves to a number`);
    assert.ok(resolved >= before);
  }
});

test('defaultIdFactory returns unique, non-empty ids', () => {
  const ids = new Set(Array.from({ length: 50 }, () => defaultIdFactory()));

  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(id.length > 0);
});

test('defaultIdFactory falls back to a prefixed counter without crypto', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  if (!descriptor || descriptor.configurable === false) {
    t.skip('crypto cannot be shadowed in this runtime');
    return;
  }

  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const first = defaultIdFactory('note');
    const second = defaultIdFactory('note');

    assert.match(first, /^note-/u);
    assert.match(second, /^note-/u);
    assert.notEqual(first, second);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});

test('resolveId keeps a free candidate and suffixes a taken one', () => {
  const items = [{ id: 'taken' }];

  assert.equal(resolveId(() => 'free', items), 'free');
  assert.equal(resolveId(() => 'taken', items), 'taken-2');
  assert.equal(resolveId(() => 'taken', [...items, { id: 'taken-2' }]), 'taken-3');
});

test('resolveId never loops forever, even with a useless factory', () => {
  assert.equal(resolveId(() => '', []).length > 0, true, 'empty ids are replaced');

  const state = Array.from({ length: 5 }, () => ({ id: 'same' }));
  const id = resolveId(() => 'same', state);
  assert.equal(id, 'same-2', 'and colliding ids stay bounded');
});
