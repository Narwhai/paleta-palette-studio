import test from 'node:test';
import assert from 'node:assert/strict';
import { okhslToHex, hexToOkhsl, contrastRatio, relativeLuminance } from '../src/color.js';
import { okhsl_to_srgb } from '../src/okhsl-reference.js';

const near = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} not near ${expected}`);

test('primary colors match Björn Ottosson OKHSL reference vectors', () => {
  const red = hexToOkhsl('#ff0000');
  near(red.h, 29.233885); near(red.s, 100); near(red.l, 56.808465);
  const green = hexToOkhsl('#00ff00');
  near(green.h, 142.495339); near(green.s, 100); near(green.l, 84.452896);
  const blue = hexToOkhsl('#0000ff');
  near(blue.h, 264.052021); near(blue.s, 100); near(blue.l, 36.656534);
  assert.equal(okhslToHex(red), '#ff0000');
  assert.equal(okhslToHex(green), '#00ff00');
  assert.equal(okhslToHex(blue), '#0000ff');
});

test('achromatic and endpoint colors are finite and roundtrip', () => {
  for (const hex of ['#000000', '#010101', '#808080', '#fefefe', '#ffffff']) {
    const color = hexToOkhsl(hex);
    assert.equal(color.h, 0); assert.equal(color.s, 0);
    assert.ok(Number.isFinite(color.l));
    assert.equal(okhslToHex(color), hex);
  }
  assert.equal(okhslToHex({ h: 20, s: 100, l: 0 }), '#000000');
  assert.equal(okhslToHex({ h: 20, s: 100, l: 100 }), '#ffffff');
});

test('hex input validates, accepts shorthand, and wraps hue', () => {
  assert.equal(okhslToHex(hexToOkhsl('#AbC')), '#aabbcc');
  for (const bad of ['blue', '#12', '#1234', '#zzzzzz', '', null, '#ffffff00']) {
    assert.throws(() => hexToOkhsl(bad), TypeError);
  }
  assert.throws(() => okhslToHex({ h: NaN, s: 2, l: 3 }), TypeError);
  assert.equal(okhslToHex({ h: 360, s: 60, l: 50 }), okhslToHex({ h: 0, s: 60, l: 50 }));
});

test('sRGB to OKHSL and back maintains 8-bit colors across hue and lightness', () => {
  for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
    const hex = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    const actual = okhslToHex(hexToOkhsl(hex));
    for (let i = 1; i < 6; i += 2) {
      assert.ok(Math.abs(parseInt(actual.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 1, `${hex} became ${actual}`);
    }
  }
});

test('WCAG contrast uses sRGB relative luminance and is symmetric', () => {
  near(contrastRatio('#000', '#fff'), 21);
  near(contrastRatio('#777777', '#ffffff'), 4.478089, 0.0001);
  near(contrastRatio('#abcdef', '#19344f'), contrastRatio('#19344f', '#abcdef'));
  near(relativeLuminance('#000'), 0); near(relativeLuminance('#fff'), 1);
});

test('roundtrips saturated blue and yellow cusp regressions without unbounded saturation', () => {
  for (const hex of ['#0033ed', '#0037fa', '#ffef3b', '#ffee70']) {
    const color = hexToOkhsl(hex);
    assert.ok(color.s >= 0 && color.s <= 100, `${hex} saturation out of range`);
    assert.equal(okhslToHex(color), hex);
  }
});

test('sampled blue and sRGB gamut faces roundtrip to within one channel level', () => {
  const check = rgb => {
    const hex = '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
    const color = hexToOkhsl(hex);
    assert.ok(Number.isFinite(color.h) && Number.isFinite(color.s) && Number.isFinite(color.l), `${hex}: non-finite OKHSL`);
    assert.ok(color.s >= 0 && color.s <= 100 && color.l >= 0 && color.l <= 100, `${hex}: out-of-range OKHSL`);
    const roundtrip = okhslToHex(color);
    for (let i = 0; i < 3; i++) {
      const channel = parseInt(roundtrip.slice(1 + i * 2, 3 + i * 2), 16);
      assert.ok(Math.abs(channel - rgb[i]) <= 1, `${hex} became ${roundtrip}`);
    }
  };
  // Dense samples around the historically difficult saturated blue region.
  for (let r = 0; r <= 24; r += 3) for (let g = 0; g <= 96; g += 3) for (let b = 144; b <= 255; b += 3) check([r, g, b]);
  // All six sRGB boundary faces, including yellow and cyan edges.
  for (let a = 0; a <= 255; a += 15) for (let b = 0; b <= 255; b += 15) for (const edge of [0, 255]) {
    check([edge, a, b]); check([a, edge, b]); check([a, b, edge]);
  }
});

test('saturated OKHSL remains finite and bounded across hues and lightnesses', () => {
  for (let h = 0; h < 360; h++) for (let l = 5; l < 100; l += 5) {
    const hex = okhslToHex({ h, s: 100, l });
    assert.match(hex, /^#[0-9a-f]{6}$/);
    const color = hexToOkhsl(hex);
    assert.ok(Number.isFinite(color.h) && Number.isFinite(color.s) && Number.isFinite(color.l), `${h}° / ${l}%`);
    assert.ok(color.s >= 0 && color.s <= 100 && color.l >= 0 && color.l <= 100);
  }
});


test('raw gamut guard corrects the blue-cusp regression without altering valid outer-pocket blue', () => {
  const beforeCusp = okhsl_to_srgb(264.052 / 360, 1, 0.39);
  const afterCusp = okhsl_to_srgb(264.0521 / 360, 1, 0.39);
  for (const channel of afterCusp) assert.ok(channel >= -0.00034 && channel <= 255.00034, `raw channel ${channel}`);
  assert.ok(Math.max(...afterCusp.map((v, i) => Math.abs(v - beforeCusp[i]))) < 0.01,
    `blue-cusp jump: ${beforeCusp} -> ${afterCusp}`);
  assert.equal(okhslToHex({ h: 264.0521, s: 100, l: 39 }), '#0034f3');
  // An intermediate point on this same ray is outside the gamut. The guard
  // corrects that point but must not change the valid, disconnected blue end.
  const blue = hexToOkhsl('#0000ff');
  assert.equal(okhslToHex(blue), '#0000ff');
  const intermediate = okhsl_to_srgb(blue.h / 360, 0.99, blue.l / 100);
  assert.ok(intermediate.every(v => v >= -0.00034 && v <= 255.00034), `${intermediate}`);
  const outer = okhsl_to_srgb(blue.h / 360, 1, blue.l / 100);
  assert.ok(outer[0] < 0.001 && outer[1] < 0.001 && outer[2] > 254.999, `${outer}`);
});

test('raw saturated samples stay within numerical tolerance of sRGB', () => {
  // The guard runs before the public hex conversion can clip invalid channels.
  for (let h = 0; h < 3600; h++) for (let l = 1; l < 100; l++) {
    const rgb = okhsl_to_srgb(h / 3600, 1, l / 100);
    assert.ok(rgb.every(v => Number.isFinite(v) && v >= -0.00034 && v <= 255.00034), `${h / 10}° / ${l}%: ${rgb}`);
  }
});

test('all standard RGB and CMY primaries roundtrip exactly', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff']) {
    assert.equal(okhslToHex(hexToOkhsl(hex)), hex);
  }
});

test('raw intermediate saturations near the blue cusp remain in gamut', () => {
  for (let step = 0; step <= 300; step++) {
    const h = 263.8 + step * 0.002;
    for (const l of [0.36, 0.366565339426, 0.37, 0.39, 0.4]) {
      for (const s of [0.9, 0.95, 0.99, 1]) {
        const rgb = okhsl_to_srgb(h / 360, s, l);
        assert.ok(rgb.every(v => Number.isFinite(v) && v >= -0.00034 && v <= 255.00034), `${h}° S=${s} L=${l}: ${rgb}`);
      }
    }
  }
});

test('extreme finite lightness values stay finite at both 8-bit endpoints', () => {
  // Include values below normal floating-point range, the reported failure,
  // and values either side of the conversion's 1e-10 normalized cutoff.
  const lightnesses = [0, Number.MIN_VALUE, 1e-300, 1e-200, 1e-158, 1e-100, 1e-50,
    1e-9, 1e-8, 1.01e-8, 100 - 1.01e-8, 100 - 1e-8,
    100 - 1e-12, 100 - 1e-14, 100];
  for (const l of lightnesses) for (const h of [0, 60, 120, 180, 240, 264.052, 300, 359, 360]) for (const s of [0, 50, 100]) {
    const hex = okhslToHex({ h, s, l });
    assert.match(hex, /^#[0-9a-f]{6}$/, `${h}° S=${s} L=${l}: ${hex}`);
    assert.equal(hex, l < 1 ? '#000000' : '#ffffff', `${h}° S=${s} L=${l}`);
  }
  assert.equal(okhslToHex({ h: 180, s: 100, l: 1e-158 }), '#000000');
});
