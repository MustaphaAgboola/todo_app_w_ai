import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

/**
 * Modules the test suite can import safely (no DOM access at module scope).
 * Discovered rather than listed, so a new `src/` module is covered
 * automatically — every shipped module must be importable in Node.
 */
const MODULES = (await readdir(new URL('src/', root)))
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => `src/${name}`);

/** Everything whose source is parsed: app.js touches the DOM, so never import it. */
const SOURCES = ['app.js', ...MODULES];

const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

const [html, styles, pkg, ...sourceList] = await Promise.all([
  read('index.html'),
  read('styles.css'),
  read('package.json'),
  ...SOURCES.map((file) => read(file)),
]);

const sourceByFile = new Map(SOURCES.map((file, index) => [file, sourceList[index]]));

const modules = new Map();
for (const file of MODULES) {
  modules.set(file, await import(new URL(file, root)));
}

const htmlIds = [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
const allSource = sourceList.join('\n');

/* ---------------------------------------------------------------- modules */

test('every relative import resolves, and every named import is exported', () => {
  const pattern = /(?:import|export)\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/gu;
  let checked = 0;

  for (const [file, source] of sourceByFile) {
    for (const [, clause, specifier] of source.matchAll(pattern)) {
      const target = path.posix.join(path.posix.dirname(file), specifier);
      const targetModule = modules.get(target);
      assert.ok(targetModule, `${file} imports "${specifier}", which is not a shipped module`);

      const names = clause
        .split(',')
        .map((entry) => entry.trim().split(/\s+as\s+/u)[0])
        .filter(Boolean);

      for (const name of names) {
        assert.ok(name in targetModule, `${file} imports "${name}" from ${target}, which does not export it`);
        checked += 1;
      }
    }
  }

  assert.ok(checked >= 40, `expected the views to import their APIs, checked ${checked}`);
});

test('no shipped module is imported by a relative path that does not exist', async () => {
  const pattern = /from\s*'(\.[^']+)'/gu;

  for (const [file, source] of sourceByFile) {
    for (const [, specifier] of source.matchAll(pattern)) {
      const target = path.posix.join(path.posix.dirname(file), specifier);
      await access(fileURLToPath(new URL(target, root)));
    }
  }
});

/* ------------------------------------------------------------------ markup */

test('every element id queried by the views exists in index.html', () => {
  const queried = SOURCES.flatMap((file) =>
    [...sourceByFile.get(file).matchAll(/querySelector\('#([^']+)'\)/gu)].map((match) => ({
      file,
      id: match[1],
    })),
  );

  assert.ok(queried.length >= 20, `expected both views to query the DOM, found ${queried.length}`);
  for (const { file, id } of queried) {
    assert.ok(htmlIds.includes(id), `${file} queries #${id} but index.html never defines it`);
  }
});

test('index.html declares no duplicate ids', () => {
  const duplicates = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], 'duplicate ids make querySelector ambiguous');
});

test('the tablist follows the ARIA tabs pattern', () => {
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/gu)].map((match) => match[0]);
  const panels = [...html.matchAll(/<section\b[^>]*role="tabpanel"[^>]*>/gu)].map((match) => match[0]);

  assert.equal(tabs.length, 2, 'a Tasks tab and a Notes tab');
  assert.equal(panels.length, 2);

  for (const tag of tabs) {
    const controls = /aria-controls="([^"]+)"/u.exec(tag)?.[1];
    assert.ok(controls && htmlIds.includes(controls), `tab points at a missing panel: ${tag}`);
    assert.match(tag, /aria-selected="(?:true|false)"/u);
    assert.match(tag, /data-view="[a-z]+"/u, `tab has no data-view: ${tag}`);
  }

  for (const tag of panels) {
    const labelledBy = /aria-labelledby="([^"]+)"/u.exec(tag)?.[1];
    assert.ok(labelledBy && htmlIds.includes(labelledBy), `panel is not labelled by a real tab: ${tag}`);
  }

  const selected = tabs.filter((tag) => /aria-selected="true"/u.test(tag));
  assert.equal(selected.length, 1, 'exactly one tab starts selected');
  assert.match(selected[0], /aria-controls="view-tasks"/u);

  const hiddenPanels = panels.filter((tag) => /\shidden(?:\s|>)/u.test(tag));
  assert.equal(hiddenPanels.length, 1, 'only the non-default panel starts hidden');
  assert.match(hiddenPanels[0], /id="view-notes"/u);
});

test('the default view activated by app.js exists as a tab', () => {
  const defaultView = /activateTab\('([^']+)'\)/u.exec(sourceByFile.get('app.js'))?.[1];

  assert.ok(defaultView, 'app.js should activate a default tab on start-up');
  assert.ok(html.includes(`data-view="${defaultView}"`), `no tab is tagged data-view="${defaultView}"`);
});

test('the theme control is a labelled select with all three choices', () => {
  const select = /<select[^>]*id="theme-select"[^>]*>([\s\S]*?)<\/select>/u.exec(html);

  assert.ok(select, 'index.html needs a #theme-select');
  assert.match(select[0], /name="theme"/u);
  assert.ok(html.includes('for="theme-select"'), 'the select needs a label');
  assert.match(select[1], /<option value="system">/u);
  assert.match(select[1], /<option value="light">/u);
  assert.match(select[1], /<option value="dark">/u);
  assert.ok(allSource.includes('themeSelect'), 'app.js should wire the control');
});

test('index.html loads the stylesheet and app entry point with relative paths', async () => {
  const assets = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/gu)].map((match) => match[1]);

  assert.ok(assets.includes('styles.css'));
  assert.ok(assets.includes('app.js'));
  for (const asset of assets) {
    await access(fileURLToPath(new URL(asset, root)));
  }
});

test('the app entry point is loaded as an ES module', () => {
  assert.match(html, /<script\s+type="module"\s+src="\.\/app\.js">/u);
  assert.equal(JSON.parse(pkg).type, 'module');
});

/* ------------------------------------------------------------------ styles */

test('styles.css defines the classes both views render', () => {
  const classes = [
    // shell + tasks
    'app',
    'tab',
    'tab--active',
    'view',
    'composer__input',
    'button',
    'panel',
    'toolbar',
    'filter',
    'filter--active',
    'todo',
    'todo__checkbox',
    'todo__title',
    'todo__actions',
    'todo--completed',
    'empty',
    'error',
    'notice',
    // notes
    'composer--stacked',
    'composer__textarea',
    'search',
    'notes',
    'note',
    'note--pinned',
    'note__header',
    'note__title',
    'note__title--untitled',
    'note__meta',
    'note__body',
    'note__actions',
    'note__edit',
    'note__edit-title',
    'note__edit-body',
    // theme
    'theme',
    'theme__label',
    'theme__select',
    'app__footer',
    'app__data',
    'status',
    'toast',
    'toast__message',
  ];

  for (const className of classes) {
    assert.ok(styles.includes(`.${className}`), `styles.css is missing .${className}`);
  }
});

test('the stylesheet keeps `hidden` authoritative', () => {
  assert.match(styles, /\[hidden\]\s*\{[^}]*display:\s*none/u, 'panels rely on the hidden attribute');
});

/* ----------------------------------------------------------------- safety */

test('the views never inject user text through innerHTML', () => {
  const forbidden = [/\.innerHTML\s*=/u, /\.outerHTML\s*=/u, /insertAdjacentHTML\s*\(/u, /document\.write\s*\(/u];

  for (const pattern of forbidden) {
    assert.ok(!pattern.test(allSource), `a view uses ${pattern}; titles go through textContent`);
  }
});

test('index.html ships no inline event handlers or scripts', () => {
  assert.ok(!/\son\w+="/u.test(html), 'inline handlers would break the strict script policy');
  assert.equal([...html.matchAll(/<script\b/gu)].length, 1, 'exactly one script tag');
});

/* -------------------------------------------------------------- data & undo */

test('the undo prompt and data controls live outside the tab panels', () => {
  const panelsAt = Math.max(html.indexOf('id="view-tasks"'), html.indexOf('id="view-notes"'));
  const scriptAt = html.indexOf('<script');

  for (const id of ['export-data', 'import-data', 'import-file', 'data-status', 'undo-toast']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > panelsAt, `#${id} must not be nested inside a tab panel`);
    assert.ok(at < html.indexOf('</main>'), `#${id} must stay inside <main>`);
    assert.ok(at < scriptAt, `#${id} must be authored in the markup, not built by script`);
  }
});

test('the undo prompt starts hidden and offers both actions', () => {
  const toast = /<div class="toast" id="undo-toast"[^>]*>/u.exec(html)?.[0];

  assert.ok(toast, 'the toast element exists');
  assert.match(toast, /\shidden/u, 'it stays hidden until something is undoable');
  assert.match(html, /<p class="toast__message" id="undo-message" role="status">/u);
  assert.match(html, /<button class="button button--primary" id="undo-button"/u);
  assert.match(html, /<button[^>]*id="undo-dismiss"[^>]*aria-label="[^"]+"/u, 'dismiss needs a name');
});

test('the file input is hidden and out of the tab order, behind a real button', () => {
  const input = /<input[^>]*id="import-file"[^>]*>/u.exec(html)?.[0];

  assert.ok(input, 'the file input exists');
  assert.match(input, /type="file"/u);
  assert.match(input, /class="visually-hidden"/u);
  assert.match(input, /tabindex="-1"/u, 'keyboard users reach the visible button instead');
  assert.match(html, /<button class="button button--ghost" id="import-data" type="button">/u);
});
