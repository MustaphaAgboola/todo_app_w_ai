/**
 * UI layer: wires the pure reducers in `src/store.js` to the DOM and persists
 * every change through `src/storage.js`. User text is always written with
 * `textContent` (never `innerHTML`), so titles cannot be read as markup.
 */

import { backupFileName, buildBackup, describeBackup, parseBackup } from './src/backup.js';
import { createButton } from './src/dom.js';
import { createHistory, dropLatestEntry, latestEntry, recordEntry } from './src/history.js';
import { createNotesView } from './src/notes-view.js';
import {
  FILTERS,
  MAX_TITLE_LENGTH,
  addTodo,
  clearCompleted,
  countActive,
  countCompleted,
  createInitialState,
  removeTodo,
  sanitizeState,
  selectVisibleTodos,
  serializeState,
  setFilter,
  toggleAll,
  toggleTodo,
  updateTodo,
} from './src/store.js';
import {
  NOTES_STORAGE_KEY,
  STORAGE_KEY,
  createLocalStorageAdapter,
  getDefaultStorage,
  loadState,
  saveState,
} from './src/storage.js';
import {
  THEMES,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  initialThemePreference,
  normalizeThemePreference,
  resolveEffectiveTheme,
} from './src/theme.js';

const elements = {
  tabs: document.querySelector('#tabs'),
  tasksPanel: document.querySelector('#view-tasks'),
  notesPanel: document.querySelector('#view-notes'),
  form: document.querySelector('#new-todo-form'),
  input: document.querySelector('#new-todo'),
  inputError: document.querySelector('#input-error'),
  list: document.querySelector('#todo-list'),
  emptyState: document.querySelector('#empty-state'),
  toggleAll: document.querySelector('#toggle-all'),
  filters: document.querySelector('#filters'),
  itemsLeft: document.querySelector('#items-left'),
  clearCompleted: document.querySelector('#clear-completed'),
  storageNotice: document.querySelector('#storage-notice'),
  exportButton: document.querySelector('#export-data'),
  importButton: document.querySelector('#import-data'),
  importFile: document.querySelector('#import-file'),
  dataStatus: document.querySelector('#data-status'),
  themeSelect: document.querySelector('#theme-select'),
  undoToast: document.querySelector('#undo-toast'),
  undoMessage: document.querySelector('#undo-message'),
  undoButton: document.querySelector('#undo-button'),
  undoDismiss: document.querySelector('#undo-dismiss'),
};

// One probe of localStorage, three keys: tasks, notes and theme persist independently.
const storageRef = getDefaultStorage();
const storage = createLocalStorageAdapter(storageRef);
const notesStorage = createLocalStorageAdapter(storageRef, NOTES_STORAGE_KEY);
const themeStorage = createLocalStorageAdapter(storageRef, THEME_STORAGE_KEY);

/** @type {import('./src/store.js').State} */
let state = loadState(storage, sanitizeState) ?? createInitialState();

/** Id of the todo currently being renamed (UI-only, never persisted). */
let editingId = null;

/** Undo stack for destructive actions, shared by both views. */
let history = createHistory();

/* ------------------------------------------------------------------- theme */

/**
 * The theme is UI state, not domain state: it lives outside the task/notes
 * stores in its own storage key and is applied as an attribute on `<html>`.
 * 'system' means \"no attribute\", so the OS media query decides the palette.
 */
let themePreference = initialThemePreference(
  storageRef === null ? null : themeStorage.read(),
);

/** @returns {boolean} Whether the OS currently reports a dark palette. */
function systemPrefersDark() {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches === true
  );
}

function applyTheme() {
  const effective = resolveEffectiveTheme(themePreference, systemPrefersDark());
  const root = document.documentElement;

  if (themePreference === THEMES.SYSTEM) {
    root.removeAttribute(THEME_ATTRIBUTE);
  } else {
    root.setAttribute(THEME_ATTRIBUTE, effective);
  }
  root.style.colorScheme = effective;

  if (elements.themeSelect && elements.themeSelect.value !== themePreference) {
    elements.themeSelect.value = themePreference;
  }
}

/**
 * Records a preference chosen in the header control and persists it.
 * @param {unknown} value
 */
function setThemePreference(value) {
  themePreference = normalizeThemePreference(value);
  applyTheme();
  themeStorage.write(themePreference);
}

applyTheme();

if (typeof globalThis.matchMedia === 'function') {
  const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => {
    if (themePreference === THEMES.SYSTEM) applyTheme();
  };

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onSystemThemeChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(onSystemThemeChange);
  }
}

const notesView = createNotesView({
  panel: elements.notesPanel,
  adapter: notesStorage,
  onDestructiveChange: (previousNotes, message) => recordUndo({ message, notes: previousNotes }),
});

/** @returns {{ todos: *, notes: * }} The data currently held by both stores. */
const currentContents = () => ({ todos: state, notes: notesView.getState() });

/* ------------------------------------------------------------------ render */

function render() {
  renderList();
  renderToolbar();
  renderFooter();
}

function renderList() {
  const visible = selectVisibleTodos(state);
  elements.list.replaceChildren(...visible.map((todo, index) => buildTodoItem(todo, index)));
  elements.list.hidden = visible.length === 0;
  elements.emptyState.hidden = visible.length > 0;
  elements.emptyState.textContent = emptyMessage();

  if (editingId !== null) focusEditInput();
}

function emptyMessage() {
  if (state.todos.length === 0) return 'Nothing here yet. Add your first task above.';
  if (state.filter === FILTERS.ACTIVE) return 'No active tasks left. Nice work!';
  if (state.filter === FILTERS.COMPLETED) return 'Nothing completed yet.';
  return 'No tasks to show.';
}

/**
 * @param {import('./src/store.js').Todo} todo
 * @param {number} index Unique per render, used for a safe `id`/`for` pair.
 * @returns {HTMLLIElement}
 */
function buildTodoItem(todo, index) {
  const item = document.createElement('li');
  item.className = 'todo';
  item.dataset.id = todo.id;
  item.classList.toggle('todo--completed', todo.completed);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo__checkbox';
  checkbox.id = `todo-toggle-${index}`;
  checkbox.checked = todo.completed;
  checkbox.dataset.action = 'toggle';
  checkbox.setAttribute(
    'aria-label',
    todo.completed ? `Mark "${todo.title}" as active` : `Mark "${todo.title}" as completed`,
  );
  item.append(checkbox);

  if (todo.id === editingId) {
    item.append(buildEditForm(todo));
  } else {
    const title = document.createElement('label');
    title.className = 'todo__title';
    title.htmlFor = checkbox.id;
    title.textContent = todo.title;

    const actions = document.createElement('div');
    actions.className = 'todo__actions';
    actions.append(
      createButton({ label: 'Edit', action: 'edit', ariaLabel: `Edit "${todo.title}"` }),
      createButton({ label: 'Delete', action: 'delete', ariaLabel: `Delete "${todo.title}"` }),
    );

    item.append(title, actions);
  }

  return item;
}

function buildEditForm(todo) {
  const form = document.createElement('form');
  form.className = 'todo__edit';
  form.dataset.role = 'edit-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'todo__edit-input';
  input.value = todo.title;
  input.maxLength = MAX_TITLE_LENGTH;
  input.dataset.role = 'edit-input';
  input.setAttribute('aria-label', 'Edit task title');

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button button--primary';
  save.textContent = 'Save';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button button--ghost';
  cancel.dataset.action = 'cancel';
  cancel.textContent = 'Cancel';

  form.append(input, save, cancel);
  return form;
}

function renderToolbar() {
  const total = state.todos.length;
  const completed = countCompleted(state);

  elements.toggleAll.checked = total > 0 && completed === total;
  elements.toggleAll.indeterminate = completed > 0 && completed < total;
  elements.toggleAll.disabled = total === 0;

  for (const button of elements.filters.querySelectorAll('button[data-filter]')) {
    const isActive = button.dataset.filter === state.filter;
    button.classList.toggle('filter--active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

function renderFooter() {
  const active = countActive(state);
  elements.itemsLeft.textContent = active === 1 ? '1 task left' : `${active} tasks left`;
  elements.clearCompleted.disabled = countCompleted(state) === 0;
}

function focusEditInput() {
  const input = elements.list.querySelector('[data-role="edit-input"]');
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/* ------------------------------------------------------------------ update */

/**
 * Applies a new state: no-op states are ignored, everything else is persisted
 * and re-rendered.
 *
 * @param {import('./src/store.js').State} nextState
 * @param {{ message?: string }} [options] `message` marks the change as
 *   destructive and offers it for undo, e.g. `Deleted "Milk"`.
 */
function commit(nextState, options = {}) {
  if (nextState === state) return;

  const previous = state;
  state = nextState;
  saveState(storage, state, serializeState);
  render();

  if (options.message) recordUndo({ message: options.message, todos: previous });
}

/* -------------------------------------------------------------------- undo */

/** How long an undo prompt stays on screen before dismissing itself. */
const TOAST_TIMEOUT_MS = 10_000;

let toastTimer = null;

/**
 * Offers an undo for a destructive change.
 * @param {import('./src/history.js').HistoryEntry} entry
 */
function recordUndo(entry) {
  history = recordEntry(history, entry);
  elements.undoMessage.textContent = entry.message;
  elements.undoToast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideUndoToast, TOAST_TIMEOUT_MS);
}

function hideUndoToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  elements.undoToast.hidden = true;
}

/** Restores the most recent snapshot, whichever view it belongs to. */
function undoLast() {
  const entry = latestEntry(history);
  if (!entry) return;

  history = dropLatestEntry(history);

  if (entry.todos) {
    state = entry.todos;
    saveState(storage, state, serializeState);
    render();
  }

  if (entry.notes) {
    notesView.replaceState(entry.notes);
    // Only jump tabs when the undo is about notes alone.
    if (!entry.todos) activateTab('notes');
  }

  hideUndoToast();
}

/* -------------------------------------------------------------------- data */

function setDataStatus(message) {
  elements.dataStatus.textContent = message;
}

/** Downloads both stores as a single JSON file. */
function exportBackup() {
  const payload = buildBackup(currentContents());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName(payload.exportedAt);
  link.click();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  setDataStatus(`Backup downloaded: ${describeBackup(payload)}.`);
}

/**
 * Replaces both stores with the contents of a backup file. The change is put on
 * the undo stack, so a mistaken import is one click away from being reverted.
 *
 * @param {File|undefined} file
 */
async function importBackup(file) {
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch {
    setDataStatus('That file could not be read.');
    return;
  }

  const parsed = parseBackup(text);
  if (!parsed.ok) {
    setDataStatus(
      parsed.reason === 'invalid-json'
        ? 'That file is not valid JSON.'
        : 'That file does not look like a backup.',
    );
    return;
  }

  const previous = currentContents();

  if (parsed.todos) {
    state = parsed.todos;
    saveState(storage, state, serializeState);
    render();
  }
  if (parsed.notes) {
    notesView.replaceState(parsed.notes, { clearSearch: true });
  }

  recordUndo({ message: 'Imported backup', todos: previous.todos, notes: previous.notes });
  setDataStatus(`Imported ${describeBackup(currentContents())}.`);
}

/* -------------------------------------------------------------------- tabs */

const tabs = [
  { tab: elements.tabs.querySelector('#tab-tasks'), panel: elements.tasksPanel },
  { tab: elements.tabs.querySelector('#tab-notes'), panel: elements.notesPanel },
];

/**
 * Shows one panel and marks its tab selected. Follows the WAI-ARIA tabs
 * pattern: only the selected tab is in the page tab order.
 * @param {string} name Matches a tab's `data-view`.
 */
function activateTab(name) {
  for (const { tab, panel } of tabs) {
    const selected = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.classList.toggle('tab--active', selected);
    panel.hidden = !selected;
  }
}

/** @returns {number} Index of a tab button within `tabs`, or -1. */
function tabIndex(button) {
  return tabs.findIndex(({ tab }) => tab === button);
}

/* ------------------------------------------------------------------ events */

function showInputError() {
  elements.inputError.hidden = false;
  elements.input.setAttribute('aria-invalid', 'true');
  elements.input.focus();
}

function hideInputError() {
  if (elements.inputError.hidden) return;
  elements.inputError.hidden = true;
  elements.input.removeAttribute('aria-invalid');
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();

  const added = addTodo(state, elements.input.value);
  if (added === state) {
    showInputError();
    return;
  }

  hideInputError();
  elements.input.value = '';
  editingId = null;

  // A new todo is always active, so the COMPLETED filter would hide it.
  const visible = added.filter === FILTERS.COMPLETED ? setFilter(added, FILTERS.ALL) : added;
  commit(visible);
});

elements.input.addEventListener('input', hideInputError);

elements.list.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-action="toggle"]');
  const id = checkbox?.closest('.todo')?.dataset.id;
  if (!id) return;
  commit(toggleTodo(state, id, checkbox.checked));
});

elements.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  const id = button?.closest('.todo')?.dataset.id;
  if (!button || !id) return;

  switch (button.dataset.action) {
    case 'edit':
      editingId = id;
      render();
      break;
    case 'cancel':
      editingId = null;
      render();
      break;
    case 'delete': {
      const todo = state.todos.find((item) => item.id === id);
      editingId = null;
      commit(removeTodo(state, id), { message: `Deleted "${todo ? todo.title : 'task'}"` });
      break;
    }
    default:
      break;
  }
});

elements.list.addEventListener('dblclick', (event) => {
  const id = event.target.closest('.todo__title')?.closest('.todo')?.dataset.id;
  if (!id) return;
  editingId = id;
  render();
});

elements.list.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-role="edit-form"]');
  if (!form) return;
  event.preventDefault();

  const id = form.closest('.todo')?.dataset.id;
  const input = form.querySelector('[data-role="edit-input"]');
  if (!id || !input) return;

  const next = updateTodo(state, id, input.value);
  editingId = null;

  // A blank or unchanged title is a no-op: revert and just close the editor.
  if (next === state) {
    render();
    return;
  }
  commit(next);
});

elements.list.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !event.target.closest('[data-role="edit-input"]')) return;
  event.preventDefault();
  editingId = null;
  render();
});

elements.toggleAll.addEventListener('change', () => {
  // Deliberately applies to every todo, not just the visible ones.
  commit(toggleAll(state, elements.toggleAll.checked));
});

elements.filters.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  commit(setFilter(state, button.dataset.filter));
});

elements.clearCompleted.addEventListener('click', () => {
  const completed = countCompleted(state);
  if (completed === 0) return;

  editingId = null;
  commit(clearCompleted(state), {
    message: `Cleared ${completed} completed task${completed === 1 ? '' : 's'}`,
  });
});

elements.exportButton.addEventListener('click', exportBackup);

elements.importButton.addEventListener('click', () => elements.importFile.click());

elements.importFile.addEventListener('change', () => {
  const [file] = elements.importFile.files ?? [];
  // Clear the input first so choosing the same file twice still fires `change`.
  elements.importFile.value = '';
  void importBackup(file);
});

elements.undoButton.addEventListener('click', undoLast);
elements.undoDismiss.addEventListener('click', hideUndoToast);

// Cmd/Ctrl+Z undoes the last destructive action, unless the user is typing —
// in a field, the browser's own text undo should win.
globalThis.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'z' || event.shiftKey || !(event.metaKey || event.ctrlKey)) return;

  const target = event.target;
  const isTyping =
    target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable);
  if (isTyping || latestEntry(history) === null) return;

  event.preventDefault();
  undoLast();
});

elements.tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('button[role="tab"]');
  if (tab) activateTab(tab.dataset.view);
});

elements.themeSelect.addEventListener('change', () => {
  setThemePreference(elements.themeSelect.value);
});

// Left/Right arrows move between tabs, as the ARIA tabs pattern expects.
elements.tabs.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

  const index = tabIndex(event.target.closest('button[role="tab"]'));
  if (index === -1) return;

  event.preventDefault();
  const step = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(index + step + tabs.length) % tabs.length];
  activateTab(next.tab.dataset.view);
  next.tab.focus();
});

// Keep multiple open tabs in sync with each other.
globalThis.addEventListener('storage', (event) => {
  if (event.key === NOTES_STORAGE_KEY) {
    notesView.reload();
    return;
  }

  if (event.key === THEME_STORAGE_KEY) {
    themePreference = initialThemePreference(event.newValue);
    applyTheme();
    return;
  }

  if (event.key !== STORAGE_KEY || editingId !== null) return;

  const incoming = event.newValue === null ? createInitialState() : loadState(storage, sanitizeState);
  if (!incoming) return;

  state = incoming;
  render();
});

/* -------------------------------------------------------------------- init */

if (!storage.available) {
  elements.storageNotice.hidden = false;
}

activateTab('tasks');
render();
elements.input.focus();
