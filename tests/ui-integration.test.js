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
  }
  append(...children) { this.children.push(...children); }
  remove() {}
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
  focus() {}
  closest() { return null; }
  querySelector(selector) { return selector === '.preview-app' ? this.previewApp : null; }
}

test('editor flows preserve per-mode palettes, undo and export', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="code-preview"') > html.indexOf('id="theme-preview"'), 'code preview follows existing preview');
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
  const storage = new Map();
  let clipboard = '';
  const blobs = [];
  const originals = Object.fromEntries(['document', 'window', 'localStorage', 'navigator', 'URL'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  install('document', {
    getElementById: byId,
    createElement: (tag) => new Element(tag),
    addEventListener() {},
    body: new Element('body')
  });
  install('window', { confirm: () => true });
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
        assert.equal(byId('theme-preview').previewApp.style.getPropertyValue(`--${role}`), expected, `original preview ${mode} ${role}`);
      }
    };
    assert.equal(byId('base-swatches').children.length, 8);
    assert.equal(byId('accent-swatches').children.length, 8);
    assert.equal(byId('selected-name').textContent, 'Background');

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
    byId('optimize-button').click();
    assert.notDeepEqual(saved().palettes.light, before.light);
    assertPreviewsMatchPalette('light');
    byId('mode-dark').click();
    byId('optimize-button').click();
    assertPreviewsMatchPalette('dark');
    const optimizedDark = saved().palettes.dark;
    byId('mode-light').click();
    assert.equal(byId('undo-button').disabled, false, 'light undo must survive optimizing dark');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.light, before.light);
    assert.deepEqual(saved().palettes.dark, optimizedDark);
    byId('mode-dark').click();
    assert.equal(byId('undo-button').disabled, false, 'dark undo must survive undoing light');
    byId('undo-button').click();
    assert.deepEqual(saved().palettes.dark, before.dark);

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
    assert.deepEqual(json.modes.dark.red.okhsl, before.dark.red);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
