// Cross-module interaction coverage without a browser dependency. This DOM shim
// deliberately implements only the APIs the editor uses; it is not a layout or
// accessibility test. The color conversion and optimizer are the real modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { okhslToHex, hexToOkhsl, contrastRatio } from '../src/color.js';
import { generateOppositePalette } from '../src/generate.js';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.style = { setProperty(name, value) { this[name] = value; }, getPropertyValue(name) { return this[name] || ''; } };
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.validationMessage = '';
    this.scrollTop = 0;
    this.top = 0;
    this.open = false;
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  append(...children) { this.children.push(...children); }
  remove() {}
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type) {
    return Promise.all((this.listeners.get(type) || []).map((listener) => listener({ type, target: this })));
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  setCustomValidity(message) { this.validationMessage = message; }
  reportValidity() { return !this.validationMessage; }
  focus() { document.activeElement = this; }
  getBoundingClientRect() { return { top: this.top }; }
  closest() { return null; }
  querySelector(selector) { return selector === '.preview-app' ? this.previewApp : null; }
}

test('editor flows preserve per-mode palettes, undo and export', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  const reported = JSON.parse(await readFile(new URL('./fixtures/reported-palette.json', import.meta.url), 'utf8'));
  assert.ok(html.indexOf('id="code-preview"') > html.indexOf('id="theme-preview"'), 'code preview follows existing preview');
  assert.match(html, /<div class="optimize-actions">\s*<button[^>]*id="optimize-button"[^>]*>.*?<\/button>\s*<button[^>]*id="undo-button"[^>]*aria-describedby="undo-help"[^>]*disabled[^>]*>↶ Undo optimization<\/button>\s*<\/div>/, 'a visible undo button sits with Optimize and describes what it restores');
  assert.match(html, /id="undo-help">Undo restores this mode to its colors before the latest optimization, including removing any later edits\./);
  assert.match(html, /id="import-button"[^>]*aria-describedby="import-help"[^>]*>Import JSON/);
  assert.match(html, /id="import-help">Replaces both modes/);
  assert.match(html, /id="import-file"[^>]*type="file"[^>]*accept="\.json,application\/json"/);
  assert.match(html, /id="import-message"[^>]*role="status"/);
  assert.match(html, /id="generate-button"[^>]*aria-describedby="generate-help"/);
  assert.match(html, /id="undo-generation-button"[^>]*aria-describedby="undo-generation-help"[^>]*disabled/);
  assert.match(html, /id="generation-message"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="base-generate-button"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]*id="base-dialog"[^>]*aria-labelledby="base-dialog-title"[^>]*aria-describedby="base-dialog-help"/);
  assert.match(html, /id="base-bg-picker"[^>]*aria-label="Pick background color"/);
  assert.match(html, /id="base-tx-picker"[^>]*aria-label="Pick primary text color"/);
  for (const [role, name] of [['bg', 'Background'], ['tx', 'Primary text']]) {
    for (const [component, max] of [['hue', 360], ['saturation', 100], ['lightness', 100]]) {
      assert.match(html, new RegExp(`id="base-${role}-${component}"[^>]*type="range"[^>]*min="0"[^>]*max="${max}"[^>]*step="1"[^>]*aria-label="${name} ${component}"`, 'i'));
      assert.match(html, new RegExp(`id="base-${role}-${component}-value"`));
    }
  }
  assert.match(html, /Undo restores this mode's colors and optimization undo from before generation, removing later edits/);
  assert.match(html, /Text and Text 2 are checked against BG, BG 2, and UI at 7:1 and 4\.5:1/);
  assert.match(html, /Text 3 at 3:1 and each accent at 4\.5:1 are checked against BG and BG 2/);
  assert.match(html, /colors no lighter than their checked backgrounds in light mode, and no darker in dark mode/);
  assert.match(html, /best directional ratio and the selected color's actual minimum contrast/);
  assert.match(html, /The contrast check above shows only BG and BG 2/);
  assert.equal(new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])).size, [...html.matchAll(/\bid="([^"]+)"/g)].length, 'preview structure has no duplicate IDs');
  assert.match(html, /id="preview-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="preview-scroll"/);
  assert.match(html, /id="preview-scroll"[^>]*role="region"[^>]*tabindex="0"/);
  const compactColors = html.match(/<span class="mini-colors"[^>]*>(.*?)<\/span>/);
  assert.ok(compactColors, 'compact preview contains accent indicators');
  assert.equal((compactColors[1].match(/<i><\/i>/g) || []).length, 8, 'all eight accents have compact indicators');
  for (const [index, role] of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'].entries()) {
    const selector = index === 0 ? 'i' : `i:nth-child\\(${index + 1}\\)`;
    assert.match(css, new RegExp(`\\.mini-colors ${selector}\\{[^}]*background:var\\(--${role}\\)`), `compact indicator ${index + 1} uses ${role}`);
  }
  assert.doesNotMatch(css, /\.mini-colors(?:\s+i(?:\:nth-child\([^)]*\))?)?\s*\{[^}]*display\s*:\s*none/, 'compact indicators must not be hidden at narrow widths');
  assert.ok(css.includes('.preview-pane:not([data-expanded="true"]) .preview-scroll'), 'compact state hides the full preview only on narrow screens');
  assert.match(html, /<pre class="syntax-code"[^>]*tabindex="0"[^>]*><code>/);
  for (const [token, role] of Object.entries({
    comment: 'tx-3', keyword: 'purple', string: 'green', function: 'blue', type: 'yellow',
    property: 'cyan', number: 'orange', constant: 'magenta', operator: 'red'
  })) {
    assert.match(html, new RegExp(`<span class="syntax-${token}">[^<]+</span>`), `${token} appears in the code sample`);
    assert.ok(css.includes(`.syntax-${token}{color:var(--${role})}`), `${token} uses the ${role} palette role`);
  }
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  const byId = (id) => {
    assert.ok(elements.has(id), `Missing DOM element #${id}`);
    return elements.get(id);
  };
  byId('theme-preview').previewApp = new Element();
  byId('preview-toggle').setAttribute('aria-expanded', 'false');
  byId('preview-pane').setAttribute('data-expanded', 'false');
  byId('preview-pane').append(byId('preview-toggle'), byId('preview-scroll'));
  const documentListeners = new Map();
  const storage = new Map();
  let clipboard = '';
  const blobs = [];
  const originals = Object.fromEntries(['document', 'window', 'localStorage', 'navigator', 'URL'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  install('document', {
    getElementById: byId,
    createElement: (tag) => new Element(tag),
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    body: new Element('body')
  });
  install('window', { confirm: () => true, matchMedia: () => ({ matches: true }) });
  install('localStorage', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  });
  install('navigator', { clipboard: { async writeText(value) { clipboard = value; } } });
  install('URL', { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} });

  try {
    await import('../src/app.js');
    const saved = () => JSON.parse(storage.get('tone-palette-studio-v1'));
    const assertPreviewsMatchPalette = (mode) => {
      for (const [role, color] of Object.entries(saved().palettes[mode])) {
        const expected = okhslToHex(color);
        assert.equal(byId('code-preview').style.getPropertyValue(`--${role}`), expected, `code preview ${mode} ${role}`);
        assert.equal(byId('mini-preview').style.getPropertyValue(`--${role}`), expected, `compact preview ${mode} ${role}`);
        assert.equal(byId('theme-preview').previewApp.style.getPropertyValue(`--${role}`), expected, `original preview ${mode} ${role}`);
      }
    };
    assert.equal(byId('base-swatches').children.length, 8);
    assert.equal(byId('accent-swatches').children.length, 8);
    assert.equal(byId('selected-name').textContent, 'Background');
    byId('preview-toggle').click();
    assert.equal(byId('preview-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(byId('preview-pane').getAttribute('data-expanded'), 'true');
    byId('preview-scroll').top = 100;
    byId('code-preview-section').top = 500;
    byId('jump-code').click();
    assert.equal(byId('preview-scroll').scrollTop, 400, 'jump scrolls the preview pane rather than the page');
    assert.equal(document.activeElement, byId('code-preview-section'));
    byId('export-menu').hidden = true;
    documentListeners.get('keydown')({ key: 'Escape' });
    assert.equal(byId('preview-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(byId('preview-pane').getAttribute('data-expanded'), 'false');
    assert.equal(document.activeElement, byId('preview-toggle'), 'collapse restores focus');
    byId('preview-toggle').click();
    documentListeners.get('focusin')({ target: byId('preview-toggle') });
    assert.equal(byId('preview-toggle').getAttribute('aria-expanded'), 'true', 'focus within the pane keeps it expanded');
    byId('hue').focus();
    documentListeners.get('focusin')({ target: byId('hue') });
    assert.equal(byId('preview-toggle').getAttribute('aria-expanded'), 'false', 'focus returning to the editor closes the expanded pane');
    assert.equal(document.activeElement, byId('hue'), 'editor focus is preserved');
    byId('preview-toggle').click();
    byId('preview-toggle').click();
    assert.equal(byId('preview-toggle').getAttribute('aria-expanded'), 'false');

    byId('accent-swatches').children[0].click();
    assert.equal(byId('selected-name').textContent, 'Red');
    const slider = byId('hue');
    slider.value = '200';
    slider.dispatch('input');
    assert.equal(saved().palettes.light.red.h, 200);
    assert.equal(byId('theme-preview').previewApp.style.getPropertyValue('--red'), byId('hex-input').value.toLowerCase());
    assertPreviewsMatchPalette('light');

    const hex = byId('hex-input');
    const beforeInvalid = JSON.stringify(saved().palettes.light.red);
    hex.value = 'nothex';
    hex.dispatch('change');
    assert.ok(hex.validationMessage);
    assert.equal(JSON.stringify(saved().palettes.light.red), beforeInvalid);
    hex.value = '#3266ab';
    hex.dispatch('change');
    assert.equal(hex.validationMessage, '');
    assert.equal(hex.value, '#3266AB');
    const lightHex = hex.value;
    byId('mode-dark').click();
    assert.notEqual(hex.value, lightHex);
    hex.value = '#a135d2';
    hex.dispatch('change');
    assert.equal(hex.value, '#A135D2', 'dark mode is edited before exporting');
    assertPreviewsMatchPalette('dark');
    byId('mode-light').click();
    assert.equal(hex.value, lightHex);
    assertPreviewsMatchPalette('light');

    const before = saved().palettes;
    assert.equal(byId('undo-button').disabled, true, 'undo starts unavailable');
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false, 'optimization enables undo for this mode');
    assert.notDeepEqual(saved().palettes.light, before.light);
    assertPreviewsMatchPalette('light');
    slider.value = '135';
    slider.dispatch('input');
    assert.equal(saved().palettes.light.red.h, 135, 'editing after optimization remains possible');
    byId('mode-dark').click();
    assert.equal(byId('undo-button').disabled, true, 'a light snapshot does not enable dark undo');
    byId('optimize-button').click();
    assertPreviewsMatchPalette('dark');
    slider.value = '185';
    slider.dispatch('input');
    const optimizedDark = saved().palettes.dark;
    byId('mode-light').click();
    assert.equal(byId('undo-button').disabled, false, 'light undo must survive optimizing dark');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.light, before.light, 'undo restores the exact pre-optimization snapshot, including later edits');
    assert.deepEqual(saved().palettes.dark, optimizedDark, 'undo never changes the other mode');
    assertPreviewsMatchPalette('light');
    assert.equal(byId('undo-button').disabled, true, 'undo is disabled after restoring the snapshot');
    byId('mode-dark').click();
    assert.equal(byId('undo-button').disabled, false, 'dark undo must survive undoing light');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.dark, before.dark);
    assertPreviewsMatchPalette('dark');
    assert.equal(byId('undo-button').disabled, true);

    byId('copy-css').click();
    await Promise.resolve();
    assert.equal((clipboard.match(/--color-/g) || []).length, 32);
    assert.match(clipboard, /\[data-theme="dark"\]/);
    byId('download-css').click();
    byId('download-json').click();
    const css = await blobs[0].text();
    const json = JSON.parse(await blobs[1].text());
    assert.equal((css.match(/--color-/g) || []).length, 32);
    assert.equal(Object.keys(json.modes.light).length, 16);
    assert.equal(Object.keys(json.modes.dark).length, 16);
    assert.equal(json.modes.light.red.hex, '#3266ab');
    for (const mode of ['light', 'dark']) {
      for (const [role, color] of Object.entries(before[mode])) {
        assert.deepEqual(json.modes[mode][role].okhsl, color, `${mode} ${role} exports the restored exact value`);
        assert.equal(json.modes[mode][role].hex, okhslToHex(color));
        assert.ok(css.includes(`--color-${role}: ${okhslToHex(color)};`));
      }
    }

    byId('optimize-button').click();
    slider.value = '165';
    slider.dispatch('input');
    const beforeLatest = saved().palettes.dark;
    byId('optimize-button').click();
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.dark, beforeLatest, 'repeated optimization undoes the latest optimization only');
    assertPreviewsMatchPalette('dark');
    assert.equal(byId('undo-button').disabled, true);

    const fileInput = byId('import-file');
    let pickerOpened = false;
    fileInput.addEventListener('click', () => { pickerOpened = true; });
    byId('import-button').click();
    assert.equal(pickerOpened, true, 'the visible import action opens the file input');
    const importFile = (file) => {
      fileInput.files = [file];
      fileInput.value = 'C:\\fakepath\\tone-palette.json';
      return fileInput.dispatch('change');
    };
    const jsonFile = (value) => ({ text: async () => JSON.stringify(value) });
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false);
    byId('mode-light').click();
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false);
    const selectedBeforeImport = byId('selected-name').textContent;
    await importFile(jsonFile(json));
    assert.equal(fileInput.value, '', 'the file input resets, allowing the same file to be chosen again');
    assert.equal(saved().mode, 'light', 'import preserves the current mode');
    assert.equal(byId('selected-name').textContent, selectedBeforeImport, 'import preserves the selected role');
    assert.deepEqual(saved().palettes, before, 'both edited modes round-trip with exact OKHSL values');
    assertPreviewsMatchPalette('light');
    assert.equal(byId('undo-button').disabled, true, 'import clears light optimization history');
    assert.match(byId('import-message').textContent, /Imported both light and dark palettes/);
    byId('mode-dark').click();
    assert.equal(byId('undo-button').disabled, true, 'import also clears dark optimization history');
    assertPreviewsMatchPalette('dark');
    byId('download-json').click();
    const reexported = JSON.parse(await blobs.at(-1).text());
    assert.deepEqual(reexported.modes, json.modes, 'both modes export identically after importing');
    byId('copy-css').click();
    await Promise.resolve();
    for (const mode of ['light', 'dark']) {
      for (const [role, color] of Object.entries(before[mode])) {
        assert.ok(clipboard.includes(`--color-${role}: ${okhslToHex(color)};`), `imported ${mode} ${role} reaches CSS export`);
      }
    }

    slider.value = '210';
    slider.dispatch('input');
    assert.equal(saved().palettes.dark.red.h, 210, 'imported palettes remain editable');
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false, 'imported palettes remain optimizable');
    const beforeInvalidImport = structuredClone(saved());
    const invalidFiles = [
      { file: { text: async () => '{broken' }, error: /not valid JSON/ },
      { file: jsonFile({ ...json, colorSpace: 'HSL' }), error: /Expected a Tone JSON export/ },
      { file: jsonFile({ colorSpace: 'OKHSL', modes: { light: json.modes.light } }), error: /Missing dark mode/ },
      { file: jsonFile({ ...json, modes: { ...json.modes, dark: { ...json.modes.dark, blue: undefined } } }), error: /missing a valid blue color/ },
      { file: jsonFile({ ...json, modes: { ...json.modes, dark: { ...json.modes.dark, blue: { ...json.modes.dark.blue, okhsl: { h: 361, s: 20, l: 30 } } } } }), error: /finite OKHSL values/ },
      { file: jsonFile({ ...json, modes: { ...json.modes, dark: { ...json.modes.dark, blue: { ...json.modes.dark.blue, okhsl: { h: null, s: 20, l: 30 } } } } }), error: /finite OKHSL values/ },
      { file: jsonFile({ ...json, modes: { ...json.modes, dark: { ...json.modes.dark, blue: { ...json.modes.dark.blue, okhsl: { h: 20, s: -1, l: 30 } } } } }), error: /finite OKHSL values/ },
      { file: jsonFile({ ...json, modes: { ...json.modes, dark: { ...json.modes.dark, blue: { ...json.modes.dark.blue, okhsl: { h: 20, s: 20, l: 101 } } } } }), error: /finite OKHSL values/ },
      { file: jsonFile({ ...json, modes: { ...json.modes, dark: { ...json.modes.dark, blue: { ...json.modes.dark.blue, hex: 'bad' } } } }), error: /missing a valid blue color/ },
      { file: { text: async () => { throw new Error('read failed'); } }, error: /Could not read/ }
    ];
    for (const { file, error } of invalidFiles) {
      await importFile(file);
      assert.deepEqual(saved(), beforeInvalidImport, 'invalid files never partially change state or persistence');
      assert.equal(byId('undo-button').disabled, false, 'invalid files leave undo history intact');
      assert.equal(byId('import-message').hidden, false);
      assert.match(byId('import-message').textContent, error);
      assert.match(byId('import-message').textContent, /Your colors have not been changed/);
      assertPreviewsMatchPalette('dark');
    }
    const sameFile = jsonFile(json);
    await importFile(sameFile);
    assert.deepEqual(saved().palettes, before, 'a valid file can be imported after an error');
    assert.equal(byId('undo-button').disabled, true);
    slider.value = '230';
    slider.dispatch('input');
    await importFile(sameFile);
    assert.deepEqual(saved().palettes, before, 'selecting the exact same file again restores it');

    let resolveSlow;
    const slow = importFile({ text: () => new Promise((resolve) => { resolveSlow = resolve; }) });
    const latest = structuredClone(json);
    latest.modes.light.red.okhsl.h = 33;
    await importFile(jsonFile(latest));
    resolveSlow(JSON.stringify(json));
    await slow;
    assert.equal(saved().palettes.light.red.h, 33, 'an older slow read cannot overwrite the most recently selected file');

    const deferredImport = () => {
      let resolve;
      let reject;
      const pending = importFile({ text: () => new Promise((accept, fail) => { resolve = accept; reject = fail; }) });
      return { pending, resolve, reject };
    };
    const finishCancelled = async (deferred, expected, description) => {
      deferred.resolve(JSON.stringify(json));
      await deferred.pending;
      assert.deepEqual(saved(), expected, `${description}: a stale import must not overwrite the newer state`);
      assert.match(byId('import-message').textContent, /cancelled.*palette changed.*select.*again/i);
    };

    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false);
    const sliderRead = deferredImport();
    slider.value = '174';
    slider.dispatch('input');
    const afterSlider = structuredClone(saved());
    await finishCancelled(sliderRead, afterSlider, 'slider change');
    assert.equal(byId('undo-button').disabled, false, 'a cancelled import preserves optimization undo');
    assertPreviewsMatchPalette('dark');

    const hexRead = deferredImport();
    hex.value = '#2468aa';
    hex.dispatch('change');
    const afterHex = structuredClone(saved());
    await finishCancelled(hexRead, afterHex, 'hex edit');
    assert.equal(byId('undo-button').disabled, false);
    assertPreviewsMatchPalette('dark');

    const modeRead = deferredImport();
    byId('mode-light').click();
    byId('accent-swatches').children[3].click();
    assert.match(byId('import-message').textContent, /Reading JSON/, 'mode and swatch selection do not cancel a pending import');
    modeRead.resolve(JSON.stringify(json));
    await modeRead.pending;
    assert.deepEqual(saved().palettes, before, 'switching mode or selected role does not block import');
    assert.equal(saved().mode, 'light');
    assert.equal(saved().selected, 'green');
    assert.match(byId('import-message').textContent, /Imported both/);

    const optimizeRead = deferredImport();
    byId('optimize-button').click();
    const afterOptimize = structuredClone(saved());
    assert.equal(byId('undo-button').disabled, false);
    await finishCancelled(optimizeRead, afterOptimize, 'optimization');
    assert.equal(byId('undo-button').disabled, false, 'optimization remains undoable after cancelling a stale read');

    const undoRead = deferredImport();
    byId('undo-button').click();
    const afterUndo = structuredClone(saved());
    await finishCancelled(undoRead, afterUndo, 'undo');
    assert.equal(byId('undo-button').disabled, true);

    const resetRead = deferredImport();
    byId('reset-button').click();
    const afterReset = structuredClone(saved());
    await finishCancelled(resetRead, afterReset, 'reset');
    assert.equal(saved().mode, 'light');
    assert.equal(saved().selected, 'bg');

    const failingRead = deferredImport();
    slider.value = '88';
    slider.dispatch('input');
    const afterLateFailure = structuredClone(saved());
    failingRead.reject(new Error('read failed after edit'));
    await failingRead.pending;
    assert.deepEqual(saved(), afterLateFailure);
    assert.match(byId('import-message').textContent, /cancelled.*palette changed.*select.*again/i, 'a stale read failure does not overwrite the cancellation message');

    const olderRead = deferredImport();
    const newerRead = deferredImport();
    slider.value = '61';
    slider.dispatch('input');
    const afterOverlappingEdit = structuredClone(saved());
    newerRead.resolve(JSON.stringify(latest));
    olderRead.resolve(JSON.stringify(json));
    await Promise.all([olderRead.pending, newerRead.pending]);
    assert.deepEqual(saved(), afterOverlappingEdit, 'an edit cancels all overlapping pending reads');
    assert.match(byId('import-message').textContent, /cancelled.*palette changed.*select.*again/i);
    await importFile(sameFile);
    assert.deepEqual(saved().palettes, before, 'the same file can be retried after cancellation');
    assert.match(byId('import-message').textContent, /Imported both/);

    hex.value = '#2266bb';
    hex.dispatch('change');
    const beforeDraft = structuredClone(saved());
    const draftRead = deferredImport();
    hex.value = '#12';
    hex.dispatch('input');
    draftRead.resolve(JSON.stringify(json));
    await draftRead.pending;
    assert.equal(hex.value, '#12', 'an uncommitted hex draft survives the stale read');
    assert.deepEqual(saved(), beforeDraft, 'a hex draft does not change or replace the palette');
    assert.equal(byId('import-message').hidden, false, 'the cancellation message remains visible');
    assert.match(byId('import-message').textContent, /cancelled.*palette changed.*select.*again/i);

    hex.value = '#13579b';
    hex.dispatch('input');
    hex.dispatch('change');
    assert.equal(hex.value, '#13579B', 'a normal hex change still commits after cancelling import');
    assert.equal(okhslToHex(saved().palettes.light.bg), '#13579b');
    await importFile(sameFile);
    assert.deepEqual(saved().palettes, before, 'the same file can be retried after an uncommitted hex draft');
    assert.match(byId('import-message').textContent, /Imported both/);

    // Exercise the user's reported palette through the real import and button
    // handlers, not merely the optimizer function.
    const makeExport = palettes => ({
      name: 'Regression palette', colorSpace: 'OKHSL',
      modes: Object.fromEntries(Object.entries(palettes).map(([mode, colors]) => [mode,
        Object.fromEntries(Object.entries(colors).map(([role, color]) => [role, { hex: okhslToHex(color), okhsl: color }]))
      ]))
    });
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-light').click();
    assert.deepEqual(saved().palettes, reported, 'import restores both modes of the reported palette');
    byId('optimize-button').click();
    const optimized = saved().palettes;
    assert.deepEqual(optimized.dark, reported.dark, 'optimizing light does not affect dark');
    assert.deepEqual(optimized.light.tx, reported.light.tx, 'readable text is preserved');
    for (const role of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']) {
      const foreground = okhslToHex(optimized.light[role]);
      assert.notEqual(foreground, '#000000', `${role} does not collapse to black`);
      assert.ok(contrastRatio(foreground, okhslToHex(optimized.light['bg-2'])) >= 4.5, `${role} remains readable on BG 2`);
    }
    assert.match(byId('optimizer-message').textContent, /Light mode optimized/);
    assertPreviewsMatchPalette('light');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes, reported, 'undo restores the imported snapshot');
    assertPreviewsMatchPalette('light');

    const infeasible = structuredClone(reported);
    infeasible.light.ui = hexToOkhsl('#333333');
    await importFile(jsonFile(makeExport(infeasible)));
    byId('optimize-button').click();
    assert.deepEqual(saved().palettes.light.tx, infeasible.light.tx, 'infeasible text keeps its selected color');
    assert.match(byId('optimizer-message').textContent, /tx:.*ui.*best .*kept the selected color/i, 'the UI reports the limiting surface and retained selection');
    assertPreviewsMatchPalette('light');

    // Derivation preserves the source, replaces only the intended destination,
    // clears its stale optimization history, and allows exact independent undo.
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-dark').click();
    const beforeDarkOptimization = structuredClone(saved().palettes.dark);
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false, 'the old destination has optimization history');
    byId('mode-light').click();
    byId('accent-swatches').children[5].click();
    slider.value = '147';
    slider.dispatch('input');
    const sourceBeforeGeneration = structuredClone(saved().palettes.light);
    const destinationBeforeGeneration = structuredClone(saved().palettes.dark);
    const expectedDark = generateOppositePalette(sourceBeforeGeneration, 'light');
    assert.equal(byId('generate-button').textContent, 'Generate dark from light');
    assert.match(byId('generate-help').textContent, /replaces the dark palette/i);
    assert.equal(byId('undo-generation-button').disabled, true);
    byId('generate-button').click();
    assert.equal(saved().mode, 'dark', 'generated mode is immediately shown');
    assert.deepEqual(saved().palettes.light, sourceBeforeGeneration, 'the source is unchanged');
    assert.deepEqual(saved().palettes.dark, expectedDark.colors, 'every target role comes from the edited source');
    assert.equal(byId('generate-button').textContent, 'Generate light from dark');
    assert.match(byId('generate-help').textContent, /replaces the light palette/i);
    assert.equal(byId('undo-button').disabled, true, 'generation clears the replaced target optimization history');
    assert.equal(byId('undo-generation-button').disabled, false);
    assertPreviewsMatchPalette('dark');
    byId('download-json').click();
    const generatedExport = JSON.parse(await blobs.at(-1).text());
    for (const [role, color] of Object.entries(expectedDark.colors)) assert.deepEqual(generatedExport.modes.dark[role].okhsl, color, `${role} exported from generated palette`);
    slider.value = '211';
    slider.dispatch('input');
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false);
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes.dark, destinationBeforeGeneration, 'generation undo discards later target edits and optimizations');
    assert.deepEqual(saved().palettes.light, sourceBeforeGeneration);
    assert.equal(byId('undo-button').disabled, false, 'undoing generation restores the original destination optimization undo');
    assert.equal(byId('undo-generation-button').disabled, true);
    assertPreviewsMatchPalette('dark');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.dark, beforeDarkOptimization, 'restored optimization undo recovers the earlier dark palette');
    assert.deepEqual(saved().palettes.light, sourceBeforeGeneration, 'undo remains specific to its mode');
    assert.equal(byId('undo-button').disabled, true);

    await importFile(jsonFile(makeExport(reported)));
    byId('mode-light').click();
    byId('generate-button').click();
    const derivedDark = structuredClone(saved().palettes.dark);
    assert.equal(saved().mode, 'dark');
    byId('generate-button').click();
    assert.equal(saved().mode, 'light');
    assert.deepEqual(saved().palettes.dark, derivedDark, 'dark source is not changed by light generation');
    assert.deepEqual(saved().palettes.light, generateOppositePalette(derivedDark, 'dark').colors);
    assert.equal(byId('undo-generation-button').disabled, false);
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes.light, reported.light, 'light destination restores its own previous palette');
    byId('mode-dark').click();
    assert.equal(byId('undo-generation-button').disabled, false, 'dark generation history remains separate');
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes, reported, 'each mode can undo its own generation independently');

    // A replacement invalidates pending imports; invalid imports don't discard
    // generation undo, while accepted import and reset clear both histories.
    byId('mode-light').click();
    const generationRead = deferredImport();
    byId('generate-button').click();
    const afterGenerationRead = structuredClone(saved());
    await finishCancelled(generationRead, afterGenerationRead, 'generation');
    assert.equal(byId('undo-generation-button').disabled, false);
    const notesBeforeInvalidImport = byId('generation-message').textContent;
    await importFile({ text: async () => '{broken' });
    assert.equal(byId('undo-generation-button').disabled, false, 'an invalid import keeps generation undo');
    assert.equal(byId('generation-message').textContent, notesBeforeInvalidImport, 'an invalid import keeps generation notes');
    const undoGenerationRead = deferredImport();
    byId('undo-generation-button').click();
    const afterUndoGenerationRead = structuredClone(saved());
    await finishCancelled(undoGenerationRead, afterUndoGenerationRead, 'generation undo');
    byId('mode-light').click();
    byId('generate-button').click();
    assert.equal(byId('undo-generation-button').disabled, false);
    await importFile(jsonFile(makeExport(reported)));
    assert.equal(byId('undo-generation-button').disabled, true, 'a successful import clears dark generation undo');
    assert.equal(byId('generation-message').hidden, true, 'a successful import clears dark generation notes');
    byId('mode-light').click();
    assert.equal(byId('undo-generation-button').disabled, true, 'a successful import also clears light generation undo');
    assert.equal(byId('generation-message').hidden, true, 'a successful import also clears light generation notes');
    byId('generate-button').click();
    assert.equal(byId('undo-generation-button').disabled, false);
    byId('reset-button').click();
    assert.equal(byId('undo-generation-button').disabled, true, 'reset clears light generation undo');
    assert.equal(byId('generation-message').hidden, true, 'reset clears light generation notes');
    byId('mode-dark').click();
    assert.equal(byId('undo-generation-button').disabled, true, 'reset also clears dark generation undo');
    assert.equal(byId('generation-message').hidden, true, 'reset also clears dark generation notes');

    const generationInfeasible = structuredClone(reported);
    generationInfeasible.light.bg = { h: 0, s: 0, l: 0 };
    await importFile(jsonFile(makeExport(generationInfeasible)));
    byId('mode-light').click();
    byId('generate-button').click();
    assert.equal(saved().mode, 'dark');
    assert.match(byId('generation-message').textContent, /not achievable.*kept the selected color/i, 'generation reports genuine optimizer infeasibility');
    assertPreviewsMatchPalette('dark');

    // Generating light must preserve light's pre-generation optimization undo,
    // even if the generated light palette is edited and optimized afterwards.
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-light').click();
    const lightBeforeOptimization = structuredClone(saved().palettes.light);
    byId('optimize-button').click();
    const lightAfterOptimization = structuredClone(saved().palettes.light);
    assert.equal(byId('undo-button').disabled, false);
    byId('mode-dark').click();
    const darkSource = structuredClone(saved().palettes.dark);
    byId('generate-button').click();
    assert.equal(saved().mode, 'light');
    assert.equal(byId('undo-button').disabled, true, 'prior light undo is hidden while generated colors are active');
    byId('accent-swatches').children[5].click();
    slider.value = '177';
    slider.dispatch('input');
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false, 'the generated palette can have its own later optimization');
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes.light, lightAfterOptimization, 'undo generation restores the previously optimized light colors');
    assert.deepEqual(saved().palettes.dark, darkSource, 'dark source remains unchanged');
    assert.equal(byId('undo-button').disabled, false, 'the pre-generation light optimization undo is restored');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.light, lightBeforeOptimization, 'restored light optimization undo recovers its earlier palette');
    assert.equal(byId('undo-button').disabled, true);

    // Notes belong to the generated palette, survive mode changes and edits as
    // explicitly labeled historical results, and are restored with that palette.
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-light').click();
    byId('generate-button').click();
    assert.equal(saved().mode, 'dark');
    const firstNotes = byId('generation-message').textContent;
    assert.equal(byId('generation-message').hidden, false);
    assert.match(firstNotes, /Generation-time notes \(may not reflect later edits or optimization\)/);
    assert.match(firstNotes, /ui-2 and ui-3.*reversed/);
    byId('mode-light').click();
    assert.equal(byId('generation-message').hidden, true, 'notes do not leak to the other mode');
    byId('mode-dark').click();
    assert.equal(byId('generation-message').hidden, false);
    assert.equal(byId('generation-message').textContent, firstNotes, 'generation notes survive switching away and back');
    byId('accent-swatches').children[0].click();
    slider.value = '86';
    slider.dispatch('input');
    assert.equal(byId('generation-message').textContent, firstNotes, 'retained notes remain explicitly labeled as generation-time after edits');
    const firstBeforeOptimization = structuredClone(saved().palettes.dark);
    byId('optimize-button').click();
    const firstAfterOptimization = structuredClone(saved().palettes.dark);
    assert.equal(byId('generation-message').textContent, firstNotes, 'later optimization does not mislabel historical notes as current results');
    assert.equal(byId('undo-button').disabled, false);
    byId('mode-light').click();
    byId('base-swatches').children[3].click();
    byId('lightness').value = '70';
    byId('lightness').dispatch('input');
    byId('generate-button').click();
    assert.equal(saved().mode, 'dark');
    const secondNotes = byId('generation-message').textContent;
    assert.notEqual(secondNotes, firstNotes, 'repeated generation records notes from its new source');
    assert.equal(byId('undo-button').disabled, true, 'the earlier generated palette undo is unavailable while its replacement is active');
    byId('optimize-button').click();
    assert.equal(byId('undo-button').disabled, false);
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes.dark, firstAfterOptimization, 'undo repeated generation restores the prior generated palette');
    assert.match(byId('generation-message').textContent, /Generation undone/);
    assert.ok(byId('generation-message').textContent.includes(firstNotes), 'undo restores notes belonging to the restored palette');
    assert.equal(byId('generation-message').hidden, false);
    assert.equal(byId('undo-button').disabled, false, 'undo restores the previous palette optimization snapshot, not the later one');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.dark, firstBeforeOptimization, 'restored undo returns to the state before the first generated palette optimization');
    assert.equal(byId('generation-message').textContent, firstNotes, 'generation-time notes remain explicitly historical after undoing optimization');
    byId('mode-light').click();
    assert.equal(byId('generation-message').hidden, true);
    byId('mode-dark').click();
    assert.equal(byId('generation-message').textContent, firstNotes);
    await importFile(jsonFile(makeExport(reported)));
    assert.equal(byId('generation-message').hidden, true, 'accepted import clears retained generation notes');
    byId('mode-light').click();
    byId('generate-button').click();
    assert.equal(byId('generation-message').hidden, false);
    byId('reset-button').click();
    assert.equal(byId('generation-message').hidden, true, 'reset clears retained generation notes');
    byId('mode-dark').click();
    assert.equal(byId('generation-message').hidden, true, 'reset clears notes in the other mode too');

    // The anchor dialog is a separate, reversible operation on the active
    // mode's eight base roles. It never changes accents or the other mode.
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-light').click();
    byId('optimize-button').click();
    const beforeBase = structuredClone(saved());
    byId('base-generate-button').click();
    assert.equal(byId('base-dialog').open, true);
    assert.equal(byId('base-bg-hex').value, okhslToHex(beforeBase.palettes.light.bg).toUpperCase());
    assert.equal(byId('base-tx-hex').value, okhslToHex(beforeBase.palettes.light.tx).toUpperCase());
    assert.equal(document.activeElement, byId('base-bg-hex'));
    byId('base-bg-hex').value = '#123456';
    byId('base-bg-hex').dispatch('input');
    byId('base-cancel-button').click();
    assert.deepEqual(saved(), beforeBase, 'cancel does not change persisted state');
    assert.equal(document.activeElement, byId('base-generate-button'), 'cancel returns focus to its opener');
    byId('base-generate-button').click();
    byId('base-bg-hex').value = 'bad';
    byId('base-bg-hex').dispatch('input');
    byId('base-apply-button').click();
    assert.equal(byId('base-dialog').open, true, 'invalid hex keeps dialog open');
    assert.match(byId('base-dialog-error').textContent, /six-digit/);
    assert.deepEqual(saved(), beforeBase, 'invalid anchors are atomic');
    byId('base-bg-hex').value = '#faf4e6';
    byId('base-bg-hex').dispatch('input');
    byId('base-tx-picker').value = '#241c32';
    byId('base-tx-picker').dispatch('input');
    assert.equal(byId('base-tx-hex').value, '#241C32');
    assert.match(byId('base-anchor-contrast').textContent, /:1/);
    byId('base-apply-button').click();
    assert.equal(byId('base-dialog').open, false);
    assert.equal(saved().mode, 'light');
    assert.equal(okhslToHex(saved().palettes.light.bg), '#faf4e6');
    assert.equal(okhslToHex(saved().palettes.light.tx), '#241c32');
    assert.deepEqual(saved().palettes.dark, beforeBase.palettes.dark);
    for (const role of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']) assert.deepEqual(saved().palettes.light[role], beforeBase.palettes.light[role], `${role} is unchanged`);
    assert.equal(byId('undo-button').disabled, true, 'old optimizer undo is not offered on the new base palette');
    assert.equal(byId('undo-generation-button').disabled, false);
    assert.match(byId('generation-message').textContent, /Accents were unchanged/);
    assertPreviewsMatchPalette('light');
    byId('download-json').click();
    const baseExport = JSON.parse(await blobs.at(-1).text());
    assert.deepEqual(baseExport.modes.light.bg.okhsl, saved().palettes.light.bg);
    assert.deepEqual(baseExport.modes.dark.bg.okhsl, saved().palettes.dark.bg);
    byId('accent-swatches').children[0].click();
    slider.value = '170'; slider.dispatch('input');
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes, beforeBase.palettes, 'undo restores the complete pre-base palette including later edits');
    assert.equal(byId('undo-button').disabled, false, 'previous optimization history returns with the prior palette');

    // Both dialog anchors use the same OKHSL controls as the main editor,
    // while changes remain a draft until the user explicitly applies them.
    const beforeSliders = structuredClone(saved());
    const bgDraft = structuredClone(beforeSliders.palettes.light.bg);
    byId('base-generate-button').click();
    for (const [role, color] of [['bg', bgDraft], ['tx', beforeSliders.palettes.light.tx]]) {
      for (const [name, property, suffix] of [['hue', 'h', '°'], ['saturation', 's', '%'], ['lightness', 'l', '%']]) {
        assert.equal(Number(byId(`base-${role}-${name}`).value), Math.round(color[property]));
        assert.equal(byId(`base-${role}-${name}-value`).textContent, `${Math.round(color[property])}${suffix}`);
        assert.match(byId(`base-${role}-${name}`).style.background, /^linear-gradient\(to right,/);
      }
    }
    assert.equal(byId('base-bg-hue').style.background, byId('hue').style.background, 'hue uses the same fixed OKHSL spectrum as the main editor');
    for (const [name, property, value] of [['hue', 'h', 138], ['saturation', 's', 76], ['lightness', 'l', 87]]) {
      bgDraft[property] = value;
      byId(`base-bg-${name}`).value = String(value);
      byId(`base-bg-${name}`).dispatch('input');
      assert.equal(byId('base-bg-hex').value, okhslToHex(bgDraft).toUpperCase());
      assert.equal(byId('base-bg-picker').value, okhslToHex(bgDraft));
      assert.equal(byId('base-anchor-preview').style.backgroundColor, okhslToHex(bgDraft));
      assert.deepEqual(saved(), beforeSliders, 'slider changes remain a dialog draft');
    }
    const beforeHexGradient = byId('base-tx-saturation').style.background;
    byId('base-tx-hex').value = '#241C32';
    byId('base-tx-hex').dispatch('input');
    let txDraft = hexToOkhsl('#241c32');
    assert.equal(byId('base-tx-picker').value, '#241c32');
    assert.equal(Number(byId('base-tx-hue').value), Math.round(txDraft.h));
    assert.notEqual(byId('base-tx-saturation').style.background, beforeHexGradient, 'hex edits update OKHSL gradient tracks');
    byId('base-tx-picker').value = '#315b72';
    byId('base-tx-picker').dispatch('input');
    txDraft = hexToOkhsl('#315b72');
    assert.equal(byId('base-tx-hex').value, '#315B72');
    assert.equal(Number(byId('base-tx-saturation').value), Math.round(txDraft.s));
    for (const [name, property, value] of [['hue', 'h', 205], ['saturation', 's', 63], ['lightness', 'l', 22]]) {
      byId(`base-tx-${name}`).value = String(value);
      byId(`base-tx-${name}`).dispatch('input');
      txDraft[property] = value;
      assert.equal(byId('base-tx-hex').value, okhslToHex(txDraft).toUpperCase());
      assert.equal(byId('base-tx-picker').value, okhslToHex(txDraft));
      assert.equal(byId('base-anchor-preview').style.color, okhslToHex(txDraft));
    }
    const expectedTrack = (makeColor) => `linear-gradient(to right, ${Array.from({ length: 13 }, (_, index) => {
      const position = index / 12;
      return `${okhslToHex(makeColor(position))} ${Math.round(position * 100)}%`;
    }).join(', ')})`;
    assert.equal(byId('base-bg-saturation').style.background, expectedTrack((position) => ({ h: bgDraft.h, s: position * 100, l: bgDraft.l })));
    assert.equal(byId('base-bg-lightness').style.background, expectedTrack((position) => ({ h: bgDraft.h, s: bgDraft.s, l: position * 100 })));
    assert.equal(byId('base-tx-saturation').style.background, expectedTrack((position) => ({ h: txDraft.h, s: position * 100, l: txDraft.l })));
    assert.equal(byId('base-tx-lightness').style.background, expectedTrack((position) => ({ h: txDraft.h, s: txDraft.s, l: position * 100 })));
    assert.deepEqual(saved(), beforeSliders);
    byId('base-apply-button').click();
    assert.deepEqual(saved().palettes.light.bg, bgDraft, 'Apply preserves the chosen OKHSL coordinates, not a quantized hex round-trip');
    assert.deepEqual(saved().palettes.light.tx, txDraft, 'both anchors use their exact slider drafts');
    assert.deepEqual(saved().palettes.dark, beforeSliders.palettes.dark);
    for (const role of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta']) assert.deepEqual(saved().palettes.light[role], beforeSliders.palettes.light[role]);
    assertPreviewsMatchPalette('light');
    byId('download-json').click();
    const sliderExport = JSON.parse(await blobs.at(-1).text());
    assert.deepEqual(sliderExport.modes.light.bg.okhsl, bgDraft);
    assert.deepEqual(sliderExport.modes.light.tx.okhsl, txDraft);
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes, beforeSliders.palettes);

    // Invalid/partial hex remains invalid until explicitly replaced by a
    // slider edit, which starts from the last valid draft and synchronizes it.
    byId('base-generate-button').click();
    byId('base-bg-hex').value = '#12';
    byId('base-bg-hex').dispatch('input');
    byId('base-apply-button').click();
    assert.equal(byId('base-dialog').open, true);
    assert.match(byId('base-dialog-error').textContent, /six-digit/);
    byId('base-bg-hue').value = '220';
    byId('base-bg-hue').dispatch('input');
    assert.match(byId('base-bg-hex').value, /^#[0-9A-F]{6}$/);
    byId('base-cancel-button').click();
    assert.deepEqual(saved(), beforeSliders, 'cancel discards slider and partial-hex edits');

    // Hue/saturation at a black endpoint are meaningful editable coordinates
    // even though the displayed hex does not change when hue is adjusted.
    const endpointPalette = structuredClone(reported);
    endpointPalette.dark.bg = { h: 42.5, s: 62.4, l: 0 };
    await importFile(jsonFile(makeExport(endpointPalette)));
    byId('mode-dark').click();
    const beforeEndpoint = structuredClone(saved());
    byId('base-generate-button').click();
    assert.equal(byId('base-bg-hex').value, '#000000');
    byId('base-bg-hue').value = '248';
    byId('base-bg-hue').dispatch('input');
    assert.equal(byId('base-bg-hex').value, '#000000');
    byId('base-apply-button').click();
    assert.deepEqual(saved().palettes.dark.bg, { h: 248, s: 62.4, l: 0 }, 'slider-edited hidden hue and exact saturation survive identical hex');
    assert.deepEqual(saved().palettes.dark.tx, beforeEndpoint.palettes.dark.tx, 'untouched text keeps its precise OKHSL coordinates');
    assert.deepEqual(saved().palettes.light, beforeEndpoint.palettes.light);
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes, beforeEndpoint.palettes);

    // Leaving a quantized hex untouched must not round-trip and lose exact
    // stored OKHSL components, even when the displayed anchors are unchanged.
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-dark').click();
    const untouched = structuredClone(saved());
    byId('base-generate-button').click();
    byId('base-apply-button').click();
    assert.deepEqual(saved().palettes.dark.bg, untouched.palettes.dark.bg);
    assert.deepEqual(saved().palettes.dark.tx, untouched.palettes.dark.tx);
    assert.deepEqual(saved().palettes.light, untouched.palettes.light);
    assertPreviewsMatchPalette('dark');
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes, untouched.palettes);

    // A known boundary color rounds a channel differently on the raw inverse;
    // dialog selections must still be applied exactly as displayed.
    byId('base-generate-button').click();
    byId('base-bg-hex').value = '#FFEf98';
    byId('base-bg-hex').dispatch('input');
    byId('base-apply-button').click();
    assert.equal(okhslToHex(saved().palettes.dark.bg), '#ffef98', 'chosen hex is preserved exactly');
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes, untouched.palettes);

    // Preserve the earlier opposite-mode generation undo across a later base
    // generation and its undo.
    await importFile(jsonFile(makeExport(reported)));
    byId('mode-light').click();
    byId('generate-button').click();
    const generatedDark = structuredClone(saved().palettes.dark);
    byId('base-generate-button').click();
    byId('base-apply-button').click();
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes.dark, generatedDark);
    assert.equal(byId('undo-generation-button').disabled, false, 'earlier mode generation remains undoable');
    byId('undo-generation-button').click();
    assert.deepEqual(saved().palettes.dark, reported.dark);

    const baseRead = deferredImport();
    byId('base-generate-button').click();
    byId('base-apply-button').click();
    const afterBaseRead = structuredClone(saved());
    await finishCancelled(baseRead, afterBaseRead, 'base generation');

    // Editing either anchor in the modal cancels an in-flight file read before
    // it can replace the palette underneath an uncommitted draft.
    for (const [inputId, value, hexValue, shouldApply] of [
      ['base-bg-hex', '#1A2B3C', '#1A2B3C', true],
      ['base-tx-picker', '#e1d2c3', '#E1D2C3', false]
    ]) {
      await importFile(jsonFile(makeExport(reported)));
      const beforeDraft = structuredClone(saved());
      const pending = deferredImport();
      byId('base-generate-button').click();
      assert.equal(byId('base-dialog-import-notice').hidden, true);
      byId(inputId).value = value;
      byId(inputId).dispatch('input');
      assert.equal(byId('base-dialog-import-notice').hidden, false, 'cancellation is visible inside the modal');
      assert.match(byId('base-dialog-import-notice').textContent, /cancelled.*select.*again/i);
      await finishCancelled(pending, beforeDraft, 'base dialog draft');
      assert.equal(byId(inputId === 'base-bg-hex' ? 'base-bg-hex' : 'base-tx-hex').value, hexValue, 'uncommitted input survives the stale read');
      if (shouldApply) {
        byId('base-apply-button').click();
        assert.equal(okhslToHex(saved().palettes[saved().mode].bg), hexValue.toLowerCase());
      } else {
        byId('base-cancel-button').click();
        assert.deepEqual(saved(), beforeDraft, 'cancel leaves the pre-draft palette unchanged');
      }
      await importFile(jsonFile(makeExport(reported)));
      assert.deepEqual(saved().palettes, reported, 'the file can be selected again after draft cancellation');
    }
    // A slider edit also cancels a pending import before it can overwrite a
    // draft; selecting the same file again remains possible afterward.
    for (const [role, component, value] of [['bg', 'hue', 181], ['tx', 'saturation', 61]]) {
      await importFile(jsonFile(makeExport(reported)));
      const beforeDraft = structuredClone(saved());
      const pending = deferredImport();
      byId('base-generate-button').click();
      byId(`base-${role}-${component}`).value = String(value);
      byId(`base-${role}-${component}`).dispatch('input');
      const draftHex = byId(`base-${role}-hex`).value;
      assert.equal(byId('base-dialog-import-notice').hidden, false);
      await finishCancelled(pending, beforeDraft, 'base dialog slider');
      assert.equal(byId(`base-${role}-hex`).value, draftHex, 'slider draft survives the stale read');
      byId('base-cancel-button').click();
      assert.deepEqual(saved(), beforeDraft, 'cancelling after a slider edit leaves the palette unchanged');
      await importFile(jsonFile(makeExport(reported)));
      assert.deepEqual(saved().palettes, reported, 'retry succeeds after a slider draft cancelled an import');
    }
    const uneditedRead = deferredImport();
    byId('base-generate-button').click();
    byId('base-cancel-button').click();
    uneditedRead.resolve(JSON.stringify(json));
    await uneditedRead.pending;
    assert.deepEqual(saved().palettes, before, 'merely opening/cancelling an unedited dialog does not cancel a pending import');

    // A completed import while the dialog is open invalidates the draft rather
    // than allowing stale selections to overwrite the newly imported palette.
    byId('base-generate-button').click();
    await importFile(jsonFile(makeExport(reported)));
    const importedWhileOpen = structuredClone(saved());
    byId('base-apply-button').click();
    assert.deepEqual(saved(), importedWhileOpen);
    assert.match(byId('base-dialog-error').textContent, /palette changed.*reopen/i);
    assert.equal(byId('base-dialog').open, true);
    byId('base-dialog-close').click();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
