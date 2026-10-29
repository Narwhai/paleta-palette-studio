import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToOkhsl, okhslToHex } from '../src/color.js';
import { serializeBase16 } from '../src/base16.js';

const source = {
  light: {
    bg: '#f8f8f8', 'bg-2': '#eeeeee', ui: '#dddddd', 'ui-2': '#cccccc', 'ui-3': '#bbbbbb',
    'tx-3': '#777777', 'tx-2': '#555555', tx: '#111111', red: '#cc2222', orange: '#cc7722',
    yellow: '#bb9900', green: '#339933', cyan: '#229999', blue: '#3366cc', purple: '#7733aa', magenta: '#aa3377'
  },
  dark: {
    bg: '#101010', 'bg-2': '#202020', ui: '#303030', 'ui-2': '#404040', 'ui-3': '#505050',
    'tx-3': '#888888', 'tx-2': '#aaaaaa', tx: '#eeeeee', red: '#ee4444', orange: '#ee8844',
    yellow: '#ddbb22', green: '#55bb55', cyan: '#44bbbb', blue: '#5588ee', purple: '#9955cc', magenta: '#cc5599'
  }
};
const roles = [
  'bg', 'bg-2', 'ui', 'ui-2', 'ui-3', 'tx-3', 'tx-2', 'tx',
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'
];
const palette = (mode) => Object.fromEntries(Object.entries(source[mode]).map(([role, hex]) => [role, hexToOkhsl(hex)]));
const slot = (index) => `base${index.toString(16).toUpperCase().padStart(2, '0')}`;

for (const mode of ['light', 'dark']) {
  test(`Base16-style ${mode} exports each selected role once in palette order`, () => {
    const colors = palette(mode);
    assert.equal(new Set(roles).size, 16, 'every role is represented once');
    assert.equal(new Set(roles.slice(0, 8).map((role) => okhslToHex(colors[role]))).size, 8, 'the eight selected base colors are distinct');
    const before = structuredClone(colors);
    const output = serializeBase16(colors, mode);
    const lines = output.trimEnd().split('\n');
    assert.equal(lines.length, 18, 'two metadata fields and exactly 16 color slots');
    assert.equal(lines[0], `scheme: "Tone Palette ${mode === 'light' ? 'Light' : 'Dark'}"`);
    assert.equal(lines[1], 'author: "Unknown (generated with Tone)"');
    for (const [index, role] of roles.entries()) {
      assert.equal(lines[index + 2], `${slot(index)}: "${okhslToHex(colors[role]).slice(1)}"`, `${slot(index)} uses ${role}`);
    }
    assert.match(output, /\n$/);
    assert.deepEqual(colors, before, 'export must not mutate palette values');
  });
}

test('Base16 serialization rejects invalid mode and incomplete or out-of-range palettes', () => {
  assert.throws(() => serializeBase16(palette('light'), 'sepia'), /mode/i);
  assert.throws(() => serializeBase16(palette('light')), /mode/i);
  assert.throws(() => serializeBase16(null, 'light'), /palette/i);
  const missing = palette('light');
  delete missing['ui-2'];
  assert.throws(() => serializeBase16(missing, 'light'), /ui-2/i);
  for (const [property, value] of [['h', -1], ['h', 361], ['s', -0.1], ['s', 100.1], ['l', Infinity], ['l', NaN]]) {
    const invalid = palette('light');
    invalid.red[property] = value;
    assert.throws(() => serializeBase16(invalid, 'light'), /red/i, `rejects red ${property}=${value}`);
  }
});
