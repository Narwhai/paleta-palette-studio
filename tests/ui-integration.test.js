// Cross-module interaction coverage without a browser dependency. This DOM shim
// deliberately implements only the APIs the editor uses; it is not a layout or
// accessibility test. The color conversion and optimizer are the real modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { okhslToHex } from '../src/color.js';

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
  }
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
    for (const listener of this.listeners.get(type) || []) listener({ type, target: this });
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
  assert.ok(html.indexOf('id="code-preview"') > html.indexOf('id="theme-preview"'), 'code preview follows existing preview');
  assert.match(html, /<div class="optimize-actions">\s*<button[^>]*id="optimize-button"[^>]*>.*?<\/button>\s*<button[^>]*id="undo-button"[^>]*aria-describedby="undo-help"[^>]*disabled[^>]*>↶ Undo optimization<\/button>\s*<\/div>/, 'a visible undo button sits with Optimize and describes what it restores');
  assert.match(html, /id="undo-help">Undo restores this mode to its colors before the latest optimization, including removing any later edits\./);
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
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
