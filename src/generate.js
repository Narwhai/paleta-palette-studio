import { optimizeGeneratedPalette } from './optimize.js';
import { okhslToHex, relativeLuminance } from './color.js';

const roles = [
  'bg', 'bg-2', 'ui', 'ui-2', 'ui-3', 'tx-3', 'tx-2', 'tx',
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'
];

/**
 * Derive the opposite mode from the same semantic roles, without touching the
 * source. OKHSL lightness is perceptual, so reflecting it keeps the relative
 * tones while reversing the light/dark relationship. Hue and relative OKHSL
 * saturation start unchanged; the role-aware optimizer uses the original
 * colors as chroma ceilings, makes achievable contrast adjustments, and reports
 * the rest.
 */
export function generateOppositePalette(source, sourceMode) {
  if (sourceMode !== 'light' && sourceMode !== 'dark') throw new TypeError('Mode must be light or dark.');
  if (!source || typeof source !== 'object') throw new TypeError('Expected a palette.');
  const seed = {};
  for (const role of roles) {
    const color = source[role];
    if (!color || !Number.isFinite(color.h) || color.h < 0 || color.h > 360 || !Number.isFinite(color.s) || color.s < 0 || color.s > 100 || !Number.isFinite(color.l) || color.l < 0 || color.l > 100) {
      throw new TypeError(`Invalid OKHSL color for ${role}.`);
    }
    seed[role] = { h: color.h, s: color.s, l: 100 - color.l };
  }
  const mode = sourceMode === 'light' ? 'dark' : 'light';
  const { colors, warnings } = optimizeGeneratedPalette(seed, mode, source);

  // Reflection preserves deliberate source choices, even if they don't follow
  // the usual background-to-border ordering. Explain rather than rearrange.
  const surfaces = ['bg', 'bg-2', 'ui', 'ui-2', 'ui-3'];
  for (let i = 1; i < surfaces.length; i++) {
    const before = surfaces[i - 1], after = surfaces[i];
    const beforeHex = okhslToHex(colors[before]), afterHex = okhslToHex(colors[after]);
    const beforeLum = relativeLuminance(beforeHex), afterLum = relativeLuminance(afterHex);
    if (mode === 'dark' ? afterLum < beforeLum : afterLum > beforeLum) {
      warnings.push(`${before} and ${after} are reversed from the usual ${mode}-mode surface order; retained your derived colors for refinement.`);
    }
  }
  const byHex = new Map();
  for (const role of roles) {
    const hex = okhslToHex(colors[role]);
    if (!byHex.has(hex)) byHex.set(hex, []);
    byHex.get(hex).push(role);
  }
  for (const [hex, coincident] of byHex) {
    if (coincident.length > 1) warnings.push(`${coincident.join(', ')} share the displayed color ${hex}; adjust them if they need to be distinguishable.`);
  }
  return { mode, colors, warnings };
}
