import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  initialThemePreference,
  isThemePreference,
  normalizeThemePreference,
  resolveEffectiveTheme,
  sanitizeThemePreference,
} from '../src/theme.js';

test('isThemePreference accepts only the three known values', () => {
  assert.equal(isThemePreference('light'), true);
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('system'), true);

  for (const value of ['Light', 'DARK', 'auto', '', null, undefined, 42, {}, []]) {
    assert.equal(isThemePreference(value), false, `${String(value)} is not a theme`);
  }
});

test('normalizeThemePreference falls back to system for anything unknown', () => {
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('bogus'), THEMES.SYSTEM);
  assert.equal(normalizeThemePreference(null), THEMES.SYSTEM);
  assert.equal(normalizeThemePreference(undefined), THEMES.SYSTEM);
});

test('sanitizeThemePreference accepts a raw string or an envelope object', () => {
  assert.equal(sanitizeThemePreference('light'), 'light');
  assert.equal(sanitizeThemePreference({ theme: 'dark' }), 'dark');
  assert.equal(sanitizeThemePreference({ theme: 'bogus' }), THEMES.SYSTEM);
  assert.equal(sanitizeThemePreference({}), THEMES.SYSTEM);

  for (const garbage of [null, undefined, 42, [], 'DARK']) {
    assert.equal(sanitizeThemePreference(garbage), THEMES.SYSTEM, `${String(garbage)} is rejected`);
  }
});

test('initialThemePreference treats a missing value as system', () => {
  assert.equal(initialThemePreference(null), THEMES.SYSTEM);
  assert.equal(initialThemePreference(undefined), THEMES.SYSTEM);
  assert.equal(initialThemePreference(''), THEMES.SYSTEM);
  assert.equal(initialThemePreference('light'), 'light');
  assert.equal(initialThemePreference('"dark"'), THEMES.SYSTEM, 'JSON-quoted junk is not honoured');
});

test('resolveEffectiveTheme maps a preference plus the OS setting to a palette', () => {
  assert.equal(resolveEffectiveTheme('light', true), 'light', 'an explicit choice beats the OS');
  assert.equal(resolveEffectiveTheme('dark', false), 'dark', 'an explicit choice beats the OS');
  assert.equal(resolveEffectiveTheme('system', true), 'dark');
  assert.equal(resolveEffectiveTheme('system', false), 'light');
  assert.equal(resolveEffectiveTheme(undefined, false), 'light');
  assert.equal(resolveEffectiveTheme('bogus', true), 'dark', 'unknown preferences behave like system');
});

test('theme constants describe the storage contract', () => {
  assert.equal(THEME_STORAGE_KEY, 'stage1-todo-app:theme:v1');
  assert.equal(THEME_ATTRIBUTE, 'data-theme');
  assert.deepEqual({ ...THEMES }, { LIGHT: 'light', DARK: 'dark', SYSTEM: 'system' });
});
