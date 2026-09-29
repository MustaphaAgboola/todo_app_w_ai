/**
 * Minimal DOM helpers shared by the task and note views.
 *
 * Nothing here touches the DOM at module scope, so the file stays importable
 * in Node (the test suite loads it to check its exports).
 */

/**
 * Builds a `<button type="button">`. Callers that need a submit button flip
 * `type` afterwards.
 *
 * @param {Object} options
 * @param {string}  options.label      Visible text.
 * @param {string}  [options.action]   Written to `data-action` for delegation.
 * @param {string}  [options.ariaLabel] Accessible name; prefer a specific one.
 * @param {string}  [options.variant]  `icon` (default), `primary` or `ghost`.
 * @returns {HTMLButtonElement}
 */
export function createButton({ label, action, ariaLabel, variant = 'icon' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button button--${variant}`;
  if (action !== undefined) button.dataset.action = action;
  button.textContent = label;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  return button;
}
