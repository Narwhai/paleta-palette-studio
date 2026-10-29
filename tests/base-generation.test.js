import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBaseColors } from '../src/base-generation.js';
import { hexToOkhsl, okhslToHex, contrastRatio, relativeLuminance } from '../src/color.js';

const surfaceTargets = { 'bg-2': 1.04, ui: 1.08, 'ui-2': 1.14, 'ui-3': 1.22 };
const hex = color => okhslToHex(color);
const textTargets = { tx: 7, 'tx-2': 4.5, 'tx-3': 3 };
function assertTargets(colors) {
  for (const [role, target] of Object.entries(surfaceTargets)) assert.ok(contrastRatio(hex(colors.bg), hex(colors[role])) >= target, `${role} on bg`);
  for (const [role, target] of Object.entries(textTargets)) {
    for (const background of role === 'tx-3' ? ['bg', 'bg-2'] : ['bg', 'bg-2', 'ui']) {
      assert.ok(contrastRatio(hex(colors[role]), hex(colors[background])) >= target, `${role} on ${background}`);
    }
  }
}
function assertOrdering(colors) {
  const roles = ['bg', 'bg-2', 'ui', 'ui-2', 'ui-3', 'tx-3', 'tx-2', 'tx'];
  const increasing = relativeLuminance(hex(colors.tx)) > relativeLuminance(hex(colors.bg));
  for (let i = 1; i < roles.length; i++) {
    const a = relativeLuminance(hex(colors[roles[i - 1]]));
    const b = relativeLuminance(hex(colors[roles[i]]));
    assert.ok(increasing ? b > a : b < a, `${roles[i - 1]} -> ${roles[i]}`);
  }
}
for (const [background, text] of [
  ['#fffcf4', '#100f0f'], ['#100f0f', '#cecdc3'],
  ['#faf4e6', '#241c32'], ['#172735', '#eee0ba'],
  ['#000000', '#ffffff'], ['#ffffff', '#000000']
]) test(`base ramp preserves ${background} and ${text}, targets and ordering`, () => {
  const bg = hexToOkhsl(background), tx = hexToOkhsl(text);
  const originalBg = structuredClone(bg), originalTx = structuredClone(tx);
  const { colors, warnings } = generateBaseColors(bg, tx);
  assert.deepEqual(bg, originalBg); assert.deepEqual(tx, originalTx);
  assert.deepEqual(colors.bg, originalBg); assert.deepEqual(colors.tx, originalTx);
  assert.deepEqual(Object.keys(colors).sort(), ['bg', 'bg-2', 'ui', 'ui-2', 'ui-3', 'tx', 'tx-2', 'tx-3'].sort());
  assert.equal(warnings.length, 0, warnings.join('\n'));
  assertTargets(colors); assertOrdering(colors);
  for (const role of Object.keys(colors)) assert.match(hex(colors[role]), /^#[\da-f]{6}$/);
  assert.deepEqual(generateBaseColors(bg, tx), { colors, warnings }, 'deterministic');
});

test('preserves exact unquantized anchor components including hidden black and white hue', () => {
  const bg = { h: 211.17, s: 81.33, l: 100 }, tx = { h: 79.75, s: 62.8, l: 0 };
  const { colors } = generateBaseColors(bg, tx);
  assert.deepEqual(colors.bg, bg); assert.deepEqual(colors.tx, tx);
});

test('insufficient anchors warn about measured pairs while keeping both anchors', () => {
  const bg = hexToOkhsl('#777777'), tx = hexToOkhsl('#888888');
  const { colors, warnings } = generateBaseColors(bg, tx);
  assert.deepEqual(colors.bg, bg); assert.deepEqual(colors.tx, tx);
  assert.ok(warnings.some(message => /tx on bg: 1\.2\d{3}:1 \(below target 7:1\)/.test(message)));
  assert.ok(warnings.some(message => /tx-2 on ui:/.test(message)));
  assert.notEqual(hex(colors['ui-3']), hex(colors.tx), 'infeasible ramp does not force every role to the text endpoint');
});

test('the coupled 7–7.56 boundary does not pretend UI and primary text both meet targets', () => {
  const bg = hexToOkhsl('#ffffff');
  const tx = hexToOkhsl('#595959');
  const anchor = contrastRatio(hex(bg), hex(tx));
  assert.ok(anchor >= 7 && anchor < 7.56, String(anchor));
  const { colors, warnings } = generateBaseColors(bg, tx);
  assert.deepEqual(colors.bg, bg); assert.deepEqual(colors.tx, tx);
  assert.ok(contrastRatio(hex(colors.tx), hex(colors.ui)) >= 7, 'keep primary text readable on the generated ui');
  assert.ok(contrastRatio(hex(colors.ui), hex(colors.bg)) < 1.08, 'ui target is unachievable simultaneously');
  assert.ok(warnings.some(message => /^ui on bg:/.test(message)), 'warn about the actual unmet surface target');
});

for (const [background, text] of [['#ff0000', '#00ffff'], ['#00ffff', '#ff0000']]) test(`low-contrast saturated anchors preserve text hierarchy ${background} to ${text}`, () => {
  const bg = hexToOkhsl(background), tx = hexToOkhsl(text);
  const { colors, warnings } = generateBaseColors(bg, tx);
  assert.deepEqual(colors.bg, bg); assert.deepEqual(colors.tx, tx);
  const lightBackground = relativeLuminance(background) > relativeLuminance(text);
  const muted = relativeLuminance(hex(colors['tx-2']));
  const faint = relativeLuminance(hex(colors['tx-3']));
  const primary = relativeLuminance(hex(colors.tx));
  assert.ok(lightBackground ? primary < muted && muted < faint : primary > muted && muted > faint, 'text 2 remains between text 3 and primary');
  assert.ok(warnings.some(message => /^tx-2 on /.test(message)), 'the infeasible target remains visible');
});

test('identical and saturated anchors remain finite and report unmet/duplicate roles', () => {
  for (const [background, text] of [['#0000ff', '#0000ff'], ['#ffffff', '#0000ff'], ['#000000', '#ffff00']]) {
    const bg = hexToOkhsl(background), tx = hexToOkhsl(text);
    const { colors, warnings } = generateBaseColors(bg, tx);
    assert.deepEqual(colors.bg, bg); assert.deepEqual(colors.tx, tx);
    assert.ok(Object.values(colors).every(color => /^#[\da-f]{6}$/.test(hex(color))));
    if (background === text) assert.ok(warnings.some(message => /not visibly ordered/.test(message)));
  }
});

test('rejects invalid anchors without inventing fallback colors', () => {
  assert.throws(() => generateBaseColors(null, hexToOkhsl('#ffffff')), /valid OKHSL/);
  assert.throws(() => generateBaseColors({ h: 361, s: 20, l: 50 }, hexToOkhsl('#ffffff')), /valid OKHSL/);
});
