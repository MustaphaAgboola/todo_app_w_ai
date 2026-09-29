/**
 * Theme preference logic: Light / Dark / System.
 *
 * The OS-level palette already exists in `styles.css` via
 * `prefers-color-scheme`; this module adds the *choice* layer on top. It is
 * pure and DOM-free so it can be unit tested in Node: `app.js` owns reading
 * `matchMedia`, writing `documentElement.dataset` and persisting.
 *
 * @typedef {'light'|'dark'|'system'} ThemePreference
 * @typedef {'light'|'dark'} EffectiveTheme
 */

import { isPlainObject } from './shared.js';

/** Key holding the theme preference in `localStorage`. */
export const THEME_STORAGE_KEY = 'stage1-todo-app:theme:v1';

/** Attribute written on `<html>` so CSS can override the OS palette. */
export const THEME_ATTRIBUTE = 'data-theme';

export const THEMES = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
});

const THEME_VALUES = Object.freeze(Object.values(THEMES));

/**
 * @param {unknown} value
 * @returns {boolean} True for 'light', 'dark' or 'system'.
 */
export function isThemePreference(value) {
  return typeof value === 'string' && THEME_VALUES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {ThemePreference} `value` when it is a known theme, else 'system'.
 */
export function normalizeThemePreference(value) {
  return isThemePreference(value) ? value : THEMES.SYSTEM;
}

/**
 * Extracts the stored preference from an untrusted persisted document.
 * Accepts either the raw string or a `{ theme }` envelope, so a future shape
 * change does not strand existing users.
 *
 * @param {unknown} raw
 * @returns {ThemePreference}
 */
export function sanitizeThemePreference(raw) {
  if (typeof raw === 'string') return normalizeThemePreference(raw);
  if (isPlainObject(raw)) return normalizeThemePreference(raw.theme);
  return THEMES.SYSTEM;
}

/**
 * @param {unknown} stored Raw value read back from storage.
 * @returns {ThemePreference} The preference to honour on startup.
 */
export function initialThemePreference(stored) {
  if (stored === null || stored === undefined || stored === '') return THEMES.SYSTEM;
  return sanitizeThemePreference(stored);
}

/**
 * Maps a preference plus the OS setting to the concrete palette to render.
 *
 * @param {ThemePreference} [preference]
 * @param {boolean} [systemDark] Whether the OS currently prefers dark.
 * @returns {EffectiveTheme}
 */
export function resolveEffectiveTheme(preference = THEMES.SYSTEM, systemDark = false) {
  if (preference === THEMES.LIGHT) return THEMES.LIGHT;
  if (preference === THEMES.DARK) return THEMES.DARK;
  return systemDark === true ? THEMES.DARK : THEMES.LIGHT;
}
