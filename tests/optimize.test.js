import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToOkhsl, okhslToHex, okhslChroma, contrastRatio } from '../src/color.js';
import { optimizePalette } from '../src/optimize.js';

const surfaces = ['bg', 'bg-2', 'ui', 'ui-2', 'ui-3'];
const surfaceTargets = { 'bg-2': 1.04, ui: 1.08, 'ui-2': 1.14, 'ui-3': 1.22 };
const targets = { tx: 7, 'tx-2': 4.5, 'tx-3': 3, red: 4.5, orange: 4.5, yellow: 4.5, green: 4.5, cyan: 4.5, blue: 4.5, purple: 4.5, magenta: 4.5 };
function palette(mode) {
  const base = mode === 'light' ? '#eeeeee' : '#202020';
  const accents = ['#ec7973', '#e69b63', '#d9c868', '#8bbf75', '#69b9b7', '#7aa5de', '#b79dd4', '#d987b3'];
  return Object.fromEntries([...surfaces.map(role => [role, hexToOkhsl(base)]),
    ...['tx', 'tx-2', 'tx-3'].map(role => [role, hexToOkhsl('#777777')]),
    ...Object.keys(targets).slice(3).map((role, i) => [role, hexToOkhsl(accents[i])])]);
}

for (const mode of ['light', 'dark']) test(`${mode} optimizes surfaces and all foregrounds against every surface`, () => {
  const input = palette(mode); const before = structuredClone(input);
  const { colors, warnings } = optimizePalette(input, mode);
  assert.deepEqual(input, before, 'input must not be mutated');
  assert.deepEqual(colors.bg, before.bg, 'main background is the anchor');
  assert.deepEqual(warnings, []);
  for (const [role, ratio] of Object.entries(surfaceTargets)) {
    assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors.bg)) >= ratio, role);
  }
  for (const [role, ratio] of Object.entries(targets)) {
    assert.equal(colors[role].h, before[role].h, role + ' hue');
    assert.ok(okhslChroma(colors[role]) <= okhslChroma(before[role]) + 1e-7, role + ' chroma');
    for (const surface of surfaces) assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors[surface])) >= ratio, `${role} on ${surface}`);
  }
  assert.deepEqual(optimizePalette(colors, mode).colors, colors, 'repeat optimization should be stable');
});

test('impossible contrast yields explicit warnings rather than claiming success', () => {
  const input = palette('light');
  input.bg = hexToOkhsl('#000000');
  const { colors, warnings } = optimizePalette(input, 'light');
  assert.ok(warnings.some(w => w.startsWith('bg-2:')));
  assert.ok(warnings.some(w => w.startsWith('tx:')));
  assert.equal(okhslToHex(colors.tx), '#000000');
});

test('rejects invalid mode and malformed palettes', () => {
  assert.throws(() => optimizePalette(palette('light'), 'sepia'), TypeError);
  const missing = palette('light'); delete missing.red;
  assert.throws(() => optimizePalette(missing, 'light'), /red/);
  const invalid = palette('light'); invalid.bg.l = -2;
  assert.throws(() => optimizePalette(invalid, 'light'), /bg/);
});
