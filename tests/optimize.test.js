import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToOkhsl, okhslToHex, okhslChroma, contrastRatio, relativeLuminance } from '../src/color.js';
import { optimizePalette } from '../src/optimize.js';
import { readFileSync } from 'node:fs';

// Snapshot of the user-reported palette, independently of their exported files.
const reported = JSON.parse(readFileSync(new URL('./fixtures/reported-palette.json', import.meta.url), 'utf8'));

const surfaces = ['bg', 'bg-2', 'ui', 'ui-2', 'ui-3'];
const surfaceTargets = { 'bg-2': 1.04, ui: 1.08, 'ui-2': 1.14, 'ui-3': 1.22 };
const targets = { tx: 7, 'tx-2': 4.5, 'tx-3': 3, red: 4.5, orange: 4.5, yellow: 4.5, green: 4.5, cyan: 4.5, blue: 4.5, purple: 4.5, magenta: 4.5 };
const surfacesFor = role => role === 'tx' || role === 'tx-2' ? ['bg', 'bg-2', 'ui'] : ['bg', 'bg-2'];
function palette(mode) {
  const base = mode === 'light' ? '#eeeeee' : '#202020';
  const accents = ['#ec7973', '#e69b63', '#d9c868', '#8bbf75', '#69b9b7', '#7aa5de', '#b79dd4', '#d987b3'];
  return Object.fromEntries([...surfaces.map(role => [role, hexToOkhsl(base)]),
    ...['tx', 'tx-2', 'tx-3'].map(role => [role, hexToOkhsl('#777777')]),
    ...Object.keys(targets).slice(3).map((role, i) => [role, hexToOkhsl(accents[i])])]);
}

for (const mode of ['light', 'dark']) test(`${mode} optimizes surface roles and foregrounds against their actual backgrounds`, () => {
  const input = palette(mode); const before = structuredClone(input);
  const { colors, warnings } = optimizePalette(input, mode);
  assert.deepEqual(input, before, 'input must not be mutated');
  assert.deepEqual(colors.bg, before.bg, 'main background is the anchor');
  assert.deepEqual(warnings, []);
  for (const [role, ratio] of Object.entries(surfaceTargets)) {
    assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors.bg)) >= ratio, role);
  }
  const brightness = surfaces.map(role => relativeLuminance(okhslToHex(colors[role])));
  for (let i = 1; i < brightness.length; i++) {
    assert.ok(mode === 'light' ? brightness[i] < brightness[i - 1] : brightness[i] > brightness[i - 1], `${mode} surface ordering`);
  }
  for (const [role, ratio] of Object.entries(targets)) {
    assert.equal(colors[role].h, before[role].h, role + ' hue');
    assert.ok(okhslChroma(colors[role]) <= okhslChroma(before[role]) + 1e-7, role + ' chroma');
    for (const surface of surfacesFor(role)) assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors[surface])) >= ratio, `${role} on ${surface}`);
  }
  assert.deepEqual(optimizePalette(colors, mode).colors, colors, 'repeat optimization should be stable');
});

for (const mode of ['light', 'dark']) test(`reported ${mode} palette uses relevant backgrounds without collapsing colors`, () => {
  const input = reported[mode];
  const before = structuredClone(input);
  const { colors, warnings } = optimizePalette(input, mode);
  assert.deepEqual(input, before, 'optimizer never mutates the imported palette');
  assert.deepEqual(colors.tx, input.tx, 'already-readable text is not changed');
  for (const role of surfaces) assert.deepEqual(colors[role], input[role], `${role} is already distinct`);
  for (const [role, ratio] of Object.entries(targets)) {
    assert.equal(colors[role].h, input[role].h, `${role} keeps its hue`);
    assert.ok(okhslChroma(colors[role]) <= okhslChroma(input[role]) + 1e-7, `${role} chroma does not increase`);
    if (!role.startsWith('tx')) {
      assert.notEqual(okhslToHex(colors[role]), mode === 'light' ? '#000000' : '#ffffff', `${role} must retain its identity`);
    }
    for (const background of surfacesFor(role)) {
      assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors[background])) >= ratio, `${role} on ${background}`);
    }
  }
  assert.deepEqual(warnings, []);
  assert.deepEqual(optimizePalette(colors, mode).colors, colors, 'repeating optimization is stable');
});

for (const mode of ['light', 'dark']) test(`${mode} impossible contrast preserves selected colors and reports limiting roles and ratios`, () => {
  const input = palette(mode);
  input.bg = hexToOkhsl(mode === 'light' ? '#000000' : '#ffffff');
  const { colors, warnings } = optimizePalette(input, mode);
  assert.ok(warnings.some(w => /^bg-2:.*bg.*best 1\.00:1.*kept the selected color/.test(w)));
  assert.ok(warnings.some(w => /^tx:.*bg.*best 1\.00:1.*kept the selected color/.test(w)));
  assert.deepEqual(colors['bg-2'], input['bg-2']);
  assert.deepEqual(colors.tx, input.tx, 'impossible targets do not turn text black or white');
  const repeated = optimizePalette(colors, mode);
  assert.deepEqual(repeated.colors, colors);
  assert.deepEqual(repeated.warnings, warnings, 'infeasibility remains visible on a repeated run');
});

for (const mode of ['light', 'dark']) test(`${mode} warnings distinguish direction from actual contrast`, () => {
  const input = palette(mode);
  const background = mode === 'light' ? '#000000' : '#ffffff';
  const foreground = mode === 'light' ? '#ffffff' : '#000000';
  for (const role of ['bg', 'bg-2', 'ui']) input[role] = hexToOkhsl(background);
  input.tx = hexToOkhsl(foreground);
  const { colors, warnings } = optimizePalette(input, mode);
  assert.deepEqual(colors.tx, input.tx, 'opposite-side text is preserved');
  assert.equal(contrastRatio(okhslToHex(colors.tx), okhslToHex(colors.bg)), 21);
  const warning = warnings.find(w => w.startsWith('tx:'));
  assert.ok(warning, 'the directional incompatibility is reported');
  assert.match(warning, mode === 'light' ? /no lighter than/i : /no darker than/i);
  assert.match(warning, /best 1\.00:1 in that direction/i);
  assert.match(warning, /selected color.*actual.*21\.00:1/i);
  assert.match(warning, /kept the selected color/i);
});

test('an infeasible UI background does not prevent accent optimization on real backgrounds', () => {
  const input = structuredClone(reported.light);
  input.ui = hexToOkhsl('#333333');
  input.tx = hexToOkhsl('#444444');
  input['tx-2'] = hexToOkhsl('#555555');
  const { colors, warnings } = optimizePalette(input, 'light');
  assert.deepEqual(colors.tx, input.tx, 'an infeasible text target keeps the selection');
  assert.deepEqual(colors['tx-2'], input['tx-2']);
  assert.ok(warnings.some(w => /^tx:.*ui.*best .*kept the selected color/.test(w)));
  assert.ok(warnings.some(w => /^tx-2:.*ui.*best .*kept the selected color/.test(w)));
  for (const role of Object.keys(targets).slice(3)) {
    for (const background of ['bg', 'bg-2']) {
      assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors[background])) >= 4.5, `${role} on ${background}`);
    }
  }
});

test('rejects invalid mode and malformed palettes', () => {
  assert.throws(() => optimizePalette(palette('light'), 'sepia'), TypeError);
  const missing = palette('light'); delete missing.red;
  assert.throws(() => optimizePalette(missing, 'light'), /red/);
  const invalid = palette('light'); invalid.bg.l = -2;
  assert.throws(() => optimizePalette(invalid, 'light'), /bg/);
});
