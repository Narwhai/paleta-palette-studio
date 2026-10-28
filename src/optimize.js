import { okhslToHex, contrastRatio, relativeLuminance, okhslChroma } from './color.js';

// These WCAG ratios approximate the role-based method in the Earendil article;
// they are not its unpublished perceptual contrast polynomial fits.
const surfaceTargets = { 'bg-2': 1.04, ui: 1.08, 'ui-2': 1.14, 'ui-3': 1.22 };
const foregroundTargets = {
  tx: 7, 'tx-2': 4.5, 'tx-3': 3,
  red: 4.5, orange: 4.5, yellow: 4.5, green: 4.5,
  cyan: 4.5, blue: 4.5, purple: 4.5, magenta: 4.5,
};
const surfaceRoles = ['bg', ...Object.keys(surfaceTargets)];
const roles = [...surfaceRoles, ...Object.keys(foregroundTargets)];

// Anchor saturation to the selected color. As lightness approaches an endpoint,
// taper saturation and never allow the Oklab chroma to exceed the source chroma.
function candidateAt(source, lightness, sourceChroma) {
  const edge = Math.min(lightness, 100 - lightness);
  const sourceEdge = Math.min(source.l, 100 - source.l);
  const taper = sourceEdge > 0 ? Math.min(1, edge / sourceEdge) : 0;
  let saturation = source.s * taper;
  const make = s => ({ h: source.h, s, l: lightness });
  if (okhslChroma(make(saturation)) > sourceChroma + 1e-8) {
    let lo = 0, hi = saturation;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (okhslChroma(make(mid)) <= sourceChroma + 1e-8) lo = mid;
      else hi = mid;
    }
    saturation = lo;
  }
  return make(saturation);
}

/**
 * Optimize one mode without mutating the supplied OKHSL colors. Surface roles
 * are first made distinguishable from bg. Text and accent roles are then
 * checked against every surface, with the strictest requirement winning.
 * If the target is impossible even at the relevant black/white endpoint, the
 * endpoint is used and the role is listed in warnings.
 */
export function optimizePalette(colors, mode) {
  if (mode !== 'light' && mode !== 'dark') throw new TypeError('Mode must be light or dark.');
  if (!colors || typeof colors !== 'object') throw new TypeError('Expected a palette.');
  const result = {};
  for (const role of roles) {
    const color = colors[role];
    if (!color || !Number.isFinite(color.h) || !Number.isFinite(color.s) || !Number.isFinite(color.l) || color.s < 0 || color.s > 100 || color.l < 0 || color.l > 100) {
      throw new TypeError(`Invalid OKHSL color for ${role}.`);
    }
    result[role] = { h: color.h, s: color.s, l: color.l };
  }
  const warnings = [];
  const endpoint = mode === 'light' ? 0 : 100;

  function solve(role, target, backgrounds) {
    const source = result[role];
    const backgroundHexes = backgrounds.map(key => okhslToHex(result[key]));
    const backgroundLuminances = backgroundHexes.map(relativeLuminance);
    function score(color) {
      const hex = okhslToHex(color), lum = relativeLuminance(hex);
      const ratios = backgroundHexes.map((bg, i) => {
        // Avoid accepting an accidental high contrast on the wrong side.
        if (mode === 'light' ? lum > backgroundLuminances[i] : lum < backgroundLuminances[i]) return 1;
        return contrastRatio(hex, bg);
      });
      return Math.min(...ratios);
    }
    if (score(source) >= target) return;
    const sourceChroma = okhslChroma(source);
    const extreme = candidateAt(source, endpoint, sourceChroma);
    const maxScore = score(extreme);
    if (maxScore < target) {
      result[role] = extreme;
      warnings.push(`${role}: ${target}:1 is not achievable against all required surfaces (best ${maxScore.toFixed(2)}:1).`);
      return;
    }
    // Find the smallest movement toward the correct end of the scale. Evaluate
    // the quantized output too, so a displayed hex never barely misses a target.
    let from = source.l, to = endpoint;
    for (let i = 0; i < 25; i++) {
      const mid = (from + to) / 2;
      if (score(candidateAt(source, mid, sourceChroma)) >= target) to = mid;
      else from = mid;
    }
    result[role] = candidateAt(source, to, sourceChroma);
  }

  for (const [role, target] of Object.entries(surfaceTargets)) solve(role, target, ['bg']);
  for (const [role, target] of Object.entries(foregroundTargets)) solve(role, target, surfaceRoles);
  return { colors: result, warnings };
}
