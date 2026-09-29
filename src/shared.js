/**
 * Small, dependency-free helpers shared by the task and note domains.
 *
 * They live here (rather than in one of the stores) so neither domain module
 * has to import the other, and so both can be unit tested directly.
 *
 * This module must never touch the DOM: the test suite imports it in Node.
 */

/** Titles are capped so a single item cannot blow up storage or the layout. */
export const MAX_TITLE_LENGTH = 200;

/** Note bodies allow several paragraphs, but are still bounded. */
export const MAX_BODY_LENGTH = 5000;

/**
 * Collapses runs of whitespace, trims, and clamps the length.
 * @param {unknown} title
 * @returns {string} The clean title, or `''` when there is no usable text.
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/\s+/gu, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

/**
 * Normalises a note body: line endings are unified, trailing spaces on each
 * line are dropped and the whole body is trimmed. Blank lines *inside* the
 * body are preserved so paragraphing survives a round trip.
 *
 * @param {unknown} body
 * @returns {string}
 */
export function normalizeBody(body) {
  if (typeof body !== 'string') return '';
  return body
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+$/gmu, '')
    .trim()
    .slice(0, MAX_BODY_LENGTH);
}

/**
 * @returns {boolean} True for object literals (and null-prototype objects),
 *   false for arrays, `null`, class instances and primitives. Values parsed
 *   from JSON always qualify.
 */
export function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value
 * @returns {number} `value` when it is a usable timestamp, otherwise "now".
 */
export function resolveTimestamp(value) {
  return Number.isFinite(value) ? value : Date.now();
}

let fallbackIdCounter = 0;

/**
 * Id generator used when no custom `idFactory` is injected.
 * Prefers `crypto.randomUUID()` and degrades to a counter for older engines.
 *
 * @param {string} [prefix] Only used by the fallback path.
 * @returns {string}
 */
export function defaultIdFactory(prefix = 'item') {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  fallbackIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

/**
 * Resolves a unique id for an item in `items` (anything with an `id`).
 *
 * A colliding generated id gets `-2`, `-3`, ... appended, so the loop always
 * terminates even with a badly behaved `idFactory`.
 *
 * @param {() => string} idFactory
 * @param {{ id: string }[]} items
 * @param {string} [prefix]
 * @returns {string}
 */
export function resolveId(idFactory, items, prefix = 'item') {
  let candidate = String(idFactory() ?? '');
  if (!candidate) candidate = String(defaultIdFactory(prefix));

  const taken = new Set(items.map((item) => item.id));
  if (!taken.has(candidate)) return candidate;

  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}
