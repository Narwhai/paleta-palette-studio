/** OKHSL colors use degrees for hue and percentages for saturation/lightness. */
import { okhsl_to_srgb, srgb_to_okhsl, linear_srgb_to_oklab, srgb_transfer_function_inv, toe } from './okhsl-reference.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function components(color) {
  if (!color || !Number.isFinite(color.h) || !Number.isFinite(color.s) || !Number.isFinite(color.l)) {
    throw new TypeError('Expected an OKHSL color with finite h, s, and l values.');
  }
  return [((color.h % 360) + 360) % 360 / 360, clamp(color.s, 0, 100) / 100, clamp(color.l, 0, 100) / 100];
}

function parseHex(hex) {
  if (typeof hex !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) {
    throw new TypeError('Expected a hexadecimal color in #rgb or #rrggbb form.');
  }
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16));
}

export function okhslToHex(color) {
  const rgb = okhsl_to_srgb(...components(color));
  return '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
}

export function hexToOkhsl(hex) {
  const rgb = parseHex(hex);
  // Hue is undefined for grays and the original inverse divides by zero for black.
  if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) {
    const linear = srgb_transfer_function_inv(rgb[0] / 255);
    return { h: 0, s: 0, l: clamp(toe(Math.cbrt(linear)) * 100, 0, 100) };
  }
  const [h, s, l] = srgb_to_okhsl(...rgb);
  return { h: ((h * 360) % 360 + 360) % 360, s: clamp(s * 100, 0, 100), l: clamp(l * 100, 0, 100) };
}

/** WCAG 2 relative luminance of an 8-bit sRGB color. */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map(v => srgb_transfer_function_inv(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hex1, hex2) {
  const a = relativeLuminance(hex1), b = relativeLuminance(hex2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Unquantized Oklab chroma, used to avoid creating more vivid optimized colors. */
export function okhslChroma(color) {
  const rgb = okhsl_to_srgb(...components(color));
  const [, a, b] = linear_srgb_to_oklab(...rgb.map(v => srgb_transfer_function_inv(v / 255)));
  return Math.hypot(a, b);
}
