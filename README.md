# Tasks & Notes

A small, fast app for **tasks** and **notes** that runs entirely in the browser.
Add, edit, complete, filter, pin, search, undo, back up and switch themes —
everything is saved to `localStorage`, so there is no backend, no account and
no build step.

## Quick start

```bash
npm start        # serves the app on http://127.0.0.1:5173
npm test         # runs the test suite (Node's built-in test runner)
```

`npm install` is not required: the project has **zero runtime and dev
dependencies**. `scripts/serve.js` is a 76 line static file server written
against `node:http`, and it exists only because browsers refuse to load ES
modules from `file://` URLs.

Change the port with `PORT=8080 npm start`.

## Features

### Tasks

- **Add** a task with the input or the <kbd>Enter</kbd> key (blank titles are rejected).
- **Complete** a task with its checkbox, or by clicking its title.
- **Edit** in place via the *Edit* button or a double-click on the title;
  <kbd>Enter</kbd> saves, <kbd>Esc</kbd> cancels.
- **Delete** a single task, or *Clear completed* to remove them all at once.
- **Filter** by *All / Active / Completed*, with a live "tasks left" counter.
- **Select all** to complete or re-open every task in one click.

### Notes

- **Write** a note with an optional title and a multi-line body.
  <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> adds it from the body field.
- **Search** titles *and* bodies; the counter reads "2 of 5 notes" while filtering.
- **Pin** important notes to the top. Pinned notes come first, then the most
  recently updated.
- **Edit** in place via *Edit* or a double-click on the note. <kbd>Esc</kbd>
  cancels, and unsaved text survives a re-render (see *Trade-offs*).
- **Delete** a note. Notes with no title display as *Untitled note*.

### Undo

- **Deleting** a task or note, **clearing completed** tasks and **importing** a
  backup are recorded. A prompt appears with an *Undo* button, and
  <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd> does the same thing.
- Undo is global: the prompt stays put even when you switch tabs, and restoring
  a deleted note takes you back to the notes tab.
- The stack holds the last 25 destructive actions. Only destructive ones are
  recorded — ticking a task off is already one click to reverse, and recording
  every keystroke would make undo unpredictable.
- While the caret is in a text field, <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd>
  is left to the browser's own text undo.

### Backups

- **Export** downloads every task and note as one dated JSON file
  (`tasks-and-notes-2026-09-29.json`).
- **Import** restores a backup. The file is treated as untrusted input and goes
  through the same validators as `localStorage`, so a hand-edited or corrupt
  file can never break the app. A raw `localStorage` dump (tasks only, or notes
  only) imports too.
- An import replaces both lists and goes on the undo stack, so a mistaken import
  is one click to revert — which is why there is no blocking "are you sure?"
  dialog.
- Invalid files are refused with a reason, leaving your data untouched.

### Shared

- **Tabs** switch between Tasks and Notes, following the ARIA tabs pattern
  (`aria-selected`, roving `tabindex`, <kbd>←</kbd>/<kbd>→</kbd> navigation).
- **Theme** picker in the header: System (follows the OS), Light or Dark. The
  choice persists in `localStorage` and syncs across open tabs; System means no
  override is set, so the OS media query decides the palette.
- **Offline persistence** through `localStorage`, kept in sync across open tabs.
- **Accessible**: labelled controls, `aria-pressed` toggles, `aria-live`
  counters, visible focus rings, full keyboard support and a dark-mode palette.

## Project structure

```
index.html            Markup: the tablist, both panels, the data footer, the undo prompt.
app.js                Shell: tabs, the task view, undo, backup export/import.
styles.css            Themeable CSS (light + dark, responsive).
src/notes-view.js     Component for the Notes tab: list, search, inline editing.
src/store.js          Pure task state logic: reducers, selectors, validation.
src/notes.js          Pure note state logic: reducers, search, pinning, validation.
src/history.js        Pure, bounded undo stack shared by both views.
src/backup.js         Pure backup envelope: build, parse, describe.
src/storage.js        Crash-proof, domain-agnostic localStorage adapter.
src/dom.js            Tiny shared DOM helper (button builder).
src/shared.js         Primitives shared by both domains (text, ids, guards).
scripts/serve.js      Dependency-free static server for `npm start`.
test/store.test.js    Task reducer, selector and sanitisation tests.
test/notes.test.js    Note reducer, search, pinning and sanitisation tests.
test/history.test.js  Undo stack: bounds, ordering, invalid entries.
test/backup.test.js   Backup round trip, rejection reasons, sanitisation.
test/shared.test.js   Shared primitive tests (ids, text, guards).
test/storage.test.js  Persistence, quota-failure and corrupted-data tests.
test/integration.test.js  Verifies the HTML/CSS/JS wiring stays consistent.
```

## Architecture

Everything that decides *what the data looks like* is separated from the code
that draws it, so the interesting logic is testable without a browser:

- `src/store.js` and `src/notes.js` export **pure functions**. A reducer returns
  a brand new state object, or the *same reference* when nothing changed — which
  is what makes no-op detection (and the tests) straightforward. Neither module
  touches `document`, `window` or `localStorage`.
- `src/shared.js` holds the primitives both domains need (title/body
  normalisation and length caps, an id factory with collision suffixes,
  timestamp resolution, a strict plain-object guard). Keeping them there means
  `notes.js` never has to import the task store, and `store.js` keeps
  re-exporting the names it always did (`normalizeTitle`, `MAX_TITLE_LENGTH`)
  for existing callers.
- `src/storage.js` wraps `localStorage` behind a two-method interface
  (`read` / `write`) and takes the sanitizer/serializer as arguments, so it
  knows nothing about tasks or notes. Every call is wrapped in `try/catch`
  because real browsers throw on storage access — Safari private mode, disabled
  cookies, exhausted quotas — so the app degrades to "works, but doesn't
  persist" instead of breaking, and tells the user.
- `src/history.js` is the undo stack, and is just as pure: an entry records which
  snapshot to restore and the message to show. `app.js` decides *what* is worth
  recording; the module knows nothing about tasks, notes or the DOM.
- `src/backup.js` builds and parses the export file. Parsing reuses
  `sanitizeState`/`sanitizeNotes`, so an imported file is validated exactly like
  data found in `localStorage` — importing is just another untrusted input path.
- `app.js` and `src/notes-view.js` are the only modules that touch the DOM. Both
  write user text with `textContent`, so a task titled `<img onerror=…>` is
  displayed as literal text rather than executed.

### State shapes

```js
// tasks — localStorage key "stage1-todo-app:v1"
{
  todos: [{ id, title, completed, createdAt, updatedAt }],
  filter: 'all' | 'active' | 'completed',
}

// notes — localStorage key "stage1-todo-app:notes:v1"
{
  notes: [{ id, title, body, pinned, createdAt, updatedAt }],
}
```

Two separate keys keep the features independent: adding notes never rewrites the
task document, so an existing task list survives the upgrade untouched (there is
a test for exactly that). Data read back from storage is treated as untrusted and
passed through `sanitizeState()` / `sanitizeNotes()`, which drop malformed
entries, de-duplicate ids, coerce booleans and fall back to defaults for an
unknown filter. Corrupted JSON returns an empty state instead of throwing, so a
bad value can never permanently break the app. The search query and "which note
is being edited" are UI-only: they are never persisted.

## Testing

98 tests cover title/body normalisation, every reducer (including no-op,
collision and partial-update cases), the selectors, search and sort order, the
undo stack (bounds, ordering, invalid entries), backup round trips and rejection
reasons, theme mapping and sanitising, `sanitizeState`/`sanitizeNotes` with
hostile input, storage round-trips, quota failures, corrupted JSON, and the
HTML/CSS/JS wiring (every queried id exists, every import resolves, every `src/`
module is importable in Node, the tablist matches the ARIA tabs pattern, the
theme control offers all three choices, the stylesheet keeps `hidden`
authoritative, and no view uses `innerHTML`).

```bash
npm test
```

Beyond the unit tests, the UI was driven end-to-end in headless Chrome by
dispatching real `submit`, `click` and `keydown` events: 63 assertions covering
adding, filtering, editing, cancelling with <kbd>Esc</kbd>, pinning, searching,
draft preservation, deletion, undo (by button and by keyboard, including the
"don't steal text undo" guard), tab switching, exporting a backup blob,
importing a valid file, rejecting invalid ones, persistence and escaping.

## Known trade-offs

- **Undo covers destructive actions only**, and there is no redo. The stack lives
  in memory, so reloading the page clears it.
- **An import has no "are you sure?" dialog.** It goes on the undo stack instead,
  which keeps it reversible without a blocking `confirm()`.
- The undo prompt hides itself after ten seconds; the entry stays on the stack,
  so <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd> can still reach it.
- <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd> is deliberately ignored while the
  caret is in a text field, where it belongs to the browser's text undo.
- **Backups are plain, unencrypted JSON** containing whatever you typed, and
  exporting is a manual action — nothing is uploaded or scheduled.
- **The theme is UI-only state**, not domain state: it lives in its own storage
  key (`stage1-todo-app:theme:v1`) outside the task/note backups and is not
  included in exported files.
- **Search is not persisted**, and neither is the open editor or the active tab;
  they reset on reload.
- **The note editor keeps unsaved text across re-renders, the task editor does
  not.** The notes list re-renders on every keystroke in the search box, so an
  in-progress note would otherwise vanish silently; the draft is captured before
  each render and re-applied afterwards. Task titles are short and the task list
  re-renders only on explicit actions, so the simpler behaviour was kept there.
- `Select all` applies to every task, not only the tasks matching the active filter.
- The whole list is re-rendered on each change. That is more than fast enough for
  a personal list and keeps the rendering code trivial to follow.
- There is no undo, and no migration logic beyond discarding data that fails
  validation (the `version` field is stored, ready for a future migration).
- Notes are plain text: no markdown, attachments or folders — pinning and search
  are the only organisational tools.

