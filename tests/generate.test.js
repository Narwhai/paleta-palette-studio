import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToOkhsl, okhslToHex, okhslChroma, contrastRatio } from '../src/color.js';
import { optimizePalette, optimizeGeneratedPalette } from '../src/optimize.js';
import { generateOppositePalette } from '../src/generate.js';

const reported = JSON.parse(readFileSync(new URL('./fixtures/reported-palette.json', import.meta.url), 'utf8'));
const surfaceTargets = { 'bg-2': 1.04, ui: 1.08, 'ui-2': 1.14, 'ui-3': 1.22 };
const foregroundTargets = { tx: 7, 'tx-2': 4.5, 'tx-3': 3, red: 4.5, orange: 4.5, yellow: 4.5, green: 4.5, cyan: 4.5, blue: 4.5, purple: 4.5, magenta: 4.5 };
const backgroundsFor = role => role === 'tx' || role === 'tx-2' ? ['bg', 'bg-2', 'ui'] : ['bg', 'bg-2'];

for (const sourceMode of ['light', 'dark']) test(`generate ${sourceMode} to opposite mode from the supplied colors`, () => {
  const source = structuredClone(reported[sourceMode]);
  const before = structuredClone(source);
  const target = sourceMode === 'light' ? 'dark' : 'light';
  const generated = generateOppositePalette(source, sourceMode);
  assert.equal(generated.mode, target);
  assert.deepEqual(source, before, 'generation must not mutate the source');
  const reflected = Object.fromEntries(Object.entries(source).map(([role, c]) => [role, { h: c.h, s: c.s, l: 100 - c.l }]));
  assert.deepEqual(generated.colors, optimizeGeneratedPalette(reflected, target, source).colors, 'contrast is optimized from the reflected source and original chroma, not defaults');
  assert.deepEqual(generateOppositePalette(source, sourceMode), generated, 'generation is deterministic');
  assert.deepEqual(optimizePalette(generated.colors, target).colors, generated.colors, 'generated palette is already optimized');
  for (const [role, color] of Object.entries(generated.colors)) {
    assert.equal(color.h, source[role].h, `${role} retains hue`);
    assert.ok(color.s >= 0 && color.s <= 100 && color.l >= 0 && color.l <= 100, `${role} stays bounded`);
    assert.ok(okhslChroma(color) <= okhslChroma(source[role]) + 1e-7, `${role} does not exceed original chroma`);
  }
  assert.equal(generated.colors.bg.h, reflected.bg.h, 'the destination background keeps the source hue');
  assert.equal(generated.colors.bg.l, reflected.bg.l, 'the destination background is derived from the source, not a default');
  for (const [role, ratio] of Object.entries(surfaceTargets)) {
    assert.ok(contrastRatio(okhslToHex(generated.colors[role]), okhslToHex(generated.colors.bg)) >= ratio, `${role} against bg`);
  }
  for (const [role, ratio] of Object.entries(foregroundTargets)) {
    for (const bg of backgroundsFor(role)) assert.ok(contrastRatio(okhslToHex(generated.colors[role]), okhslToHex(generated.colors[bg])) >= ratio, `${role} against ${bg}`);
    if (!role.startsWith('tx')) assert.ok(!['#000000', '#ffffff'].includes(okhslToHex(generated.colors[role])), `${role} retains a chromatic identity`);
  }
});

test('generation derives a tuned default light palette without losing accent identity', () => {
  const hexes = { bg:'#fffcf4', 'bg-2':'#f2f0e5', ui:'#e6e4d9', 'ui-2':'#cecdc3', 'ui-3':'#b7b5ac', 'tx-3':'#878580', 'tx-2':'#6f6e69', tx:'#100f0f', red:'#af3029', orange:'#bc5215', yellow:'#ad8301', green:'#66800b', cyan:'#24837b', blue:'#205ea6', purple:'#5e409d', magenta:'#a02f6f' };
  const source = Object.fromEntries(Object.entries(hexes).map(([role, hex]) => [role, hexToOkhsl(hex)]));
  const { colors, warnings } = generateOppositePalette(source, 'light');
  assert.equal(warnings.length, 0);
  for (const role of Object.keys(foregroundTargets).slice(3)) {
    assert.equal(colors[role].h, source[role].h);
    assert.ok(!['#000000', '#ffffff'].includes(okhslToHex(colors[role])));
    for (const bg of ['bg', 'bg-2']) assert.ok(contrastRatio(okhslToHex(colors[role]), okhslToHex(colors[bg])) >= 4.5);
  }
});

for (const sourceMode of ['light', 'dark']) test(`${sourceMode} infeasible targets retain derived colors and report contrast notes`, () => {
  const source = structuredClone(reported[sourceMode]);
  source.bg = { h: 0, s: 0, l: sourceMode === 'light' ? 0 : 100 };
  const { colors, warnings } = generateOppositePalette(source, sourceMode);
  assert.equal(okhslToHex(colors.bg), sourceMode === 'light' ? '#ffffff' : '#000000');
  assert.ok(warnings.some(w => /^tx:.*best .*kept the selected color/.test(w)));
  assert.equal(colors.tx.h, source.tx.h);
  assert.equal(colors.tx.l, 100 - source.tx.l, 'infeasible text retains its derived lightness');
  assert.ok(okhslChroma(colors.tx) <= okhslChroma(source.tx) + 1e-7);
});

test('unusual surface order and identical generated roles are reported, not silently reordered', () => {
  const light = structuredClone(reported.light);
  const generated = generateOppositePalette(light, 'light');
  assert.ok(generated.warnings.some(w => /ui-2 and ui-3.*reversed/.test(w)));
  assert.equal(generated.colors['ui-2'].l, 100 - light['ui-2'].l);
  assert.equal(generated.colors['ui-3'].l, 100 - light['ui-3'].l);
  light.red = { ...light.blue };
  const repeated = generateOppositePalette(light, 'light');
  assert.ok(repeated.warnings.some(w => /red, blue share the displayed color/.test(w)));
});

for (const { mode, role, hex, bg, bg2, ordinaryResult, minimumChroma } of [
  { mode: 'light', role: 'yellow', hex: '#ffff00', bg: '#ffffff', bg2: '#f7f7f7', ordinaryResult: '#787968', minimumChroma: 0.12 },
  { mode: 'dark', role: 'blue', hex: '#0000ff', bg: '#000000', bg2: '#080808', ordinaryResult: '#3d69d0', minimumChroma: 0.24 }
]) test(`${mode} ${role} keeps original chroma capacity while meeting opposite-mode contrast`, () => {
  const source = structuredClone(reported[mode]);
  source.bg = hexToOkhsl(bg);
  source['bg-2'] = hexToOkhsl(bg2);
  source[role] = hexToOkhsl(hex);
  const before = structuredClone(source);
  const reflected = Object.fromEntries(Object.entries(source).map(([key, c]) => [key, { ...c, l: 100 - c.l }]));
  const destination = mode === 'light' ? 'dark' : 'light';
  const ordinary = optimizePalette(reflected, destination);
  assert.equal(okhslToHex(ordinary.colors[role]), ordinaryResult, 'ordinary optimization retains its existing reflected-seed anchor');
  const generated = generateOppositePalette(source, mode);
  const color = generated.colors[role];
  assert.deepEqual(source, before);
  assert.equal(color.h, source[role].h, 'hue is unchanged');
  assert.ok(okhslChroma(color) >= minimumChroma, 'reflected seed does not unnecessarily mute the color');
  assert.ok(okhslChroma(color) > okhslChroma(reflected[role]) + 0.04, 'the original chroma anchor allows more than the seed');
  assert.ok(okhslChroma(color) <= okhslChroma(source[role]) + 1e-7, 'chroma stays within the original source ceiling');
  for (const background of ['bg', 'bg-2']) assert.ok(contrastRatio(okhslToHex(color), okhslToHex(generated.colors[background])) >= 4.5, `${role} on ${background}`);
});

test('a reflected background cannot amplify original chroma even when no contrast adjustment is needed', () => {
  const source = structuredClone(reported.dark);
  source.bg = { h: 120, s: 100, l: 10 };
  const reflected = Object.fromEntries(Object.entries(source).map(([role, c]) => [role, { ...c, l: 100 - c.l }]));
  assert.ok(okhslChroma(reflected.bg) > okhslChroma(source.bg) * 2, 'the unbounded reflected seed would amplify chroma');
  assert.deepEqual(optimizePalette(reflected, 'light').colors.bg, reflected.bg, 'ordinary optimization keeps its background behavior');
  const generated = generateOppositePalette(source, 'dark');
  assert.equal(generated.colors.bg.h, source.bg.h);
  assert.equal(generated.colors.bg.l, 90);
  assert.ok(generated.colors.bg.s < source.bg.s);
  assert.ok(okhslChroma(generated.colors.bg) <= okhslChroma(source.bg) + 1e-7, 'generation caps even the anchor background to the source color');
});

test('highly saturated blue and endpoints remain finite and hue-preserving', () => {
  const source = structuredClone(reported.light);
  source.blue = hexToOkhsl('#0000ff');
  source.bg = { h: 0, s: 0, l: 100 };
  source.tx = { h: 0, s: 0, l: 0 };
  const { colors } = generateOppositePalette(source, 'light');
  assert.equal(colors.blue.h, source.blue.h);
  assert.match(okhslToHex(colors.blue), /^#[\da-f]{6}$/);
  assert.equal(okhslToHex(colors.bg), '#000000');
  assert.equal(okhslToHex(colors.tx), '#ffffff');
});

test('rejects malformed source palettes and modes', () => {
  assert.throws(() => generateOppositePalette(reported.light, 'sepia'), /Mode/);
  const missing = structuredClone(reported.light); delete missing.red;
  assert.throws(() => generateOppositePalette(missing, 'light'), /red/);
  const invalid = structuredClone(reported.dark); invalid.blue.h = 361;
  assert.throws(() => generateOppositePalette(invalid, 'dark'), /blue/);
  assert.throws(() => optimizeGeneratedPalette(reported.light, 'light', null), /source palette/);
});
