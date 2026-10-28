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
const textSurfaces = ['bg', 'bg-2', 'ui'];
const backgroundSurfaces = ['bg', 'bg-2'];
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
 * are first made distinguishable from bg. Text and accent roles are checked
 * against the surfaces on which the preview actually uses them; the strictest
 * requirement wins. UI-2 and UI-3 are borders/details, not text backgrounds.
 * If a target is impossible even at the relevant black/white endpoint, the
 * selected color is kept and the limiting surface is reported in warnings.
 */
export function optimizePalette(colors, mode) {
  return optimize(colors, mode, null);
}

/** Optimize reflected colors using the original mode as the chroma anchor. */
export function optimizeGeneratedPalette(colors, mode, sourceColors) {
  if (!sourceColors || typeof sourceColors !== 'object') throw new TypeError('Expected the source palette.');
  return optimize(colors, mode, sourceColors);
}

function optimize(colors, mode, sourceColors) {
  if (mode !== 'light' && mode !== 'dark') throw new TypeError('Mode must be light or dark.');
  if (!colors || typeof colors !== 'object') throw new TypeError('Expected a palette.');
  const result = {};
  const anchors = sourceColors ? {} : null;
  for (const role of roles) {
    const color = colors[role];
    if (!color || !Number.isFinite(color.h) || !Number.isFinite(color.s) || !Number.isFinite(color.l) || color.s < 0 || color.s > 100 || color.l < 0 || color.l > 100) {
      throw new TypeError(`Invalid OKHSL color for ${role}.`);
    }
    let selected = { h: color.h, s: color.s, l: color.l };
    if (anchors) {
      const original = sourceColors[role];
      if (!original || !Number.isFinite(original.h) || !Number.isFinite(original.s) || !Number.isFinite(original.l) || original.s < 0 || original.s > 100 || original.l < 0 || original.l > 100) {
        throw new TypeError(`Invalid source OKHSL color for ${role}.`);
      }
      const chroma = okhslChroma(original);
      anchors[role] = { chroma, saturation: original.s };
      // A reflected seed can itself be more chromatic than the original. Cap
      // only when necessary; keep invisible endpoint saturation otherwise.
      if (okhslChroma(selected) > chroma + 1e-8) selected = candidateAt(selected, selected.l, chroma);
    }
    result[role] = selected;
  }
  const warnings = [];
  const endpoint = mode === 'light' ? 0 : 100;

  function solve(role, target, backgrounds) {
    const source = result[role];
    const backgroundHexes = backgrounds.map(key => okhslToHex(result[key]));
    const backgroundLuminances = backgroundHexes.map(relativeLuminance);
    function scores(color) {
      const hex = okhslToHex(color), lum = relativeLuminance(hex);
      return backgroundHexes.map((bg, i) => {
        // Avoid accepting an accidental high contrast on the wrong side.
        if (mode === 'light' ? lum > backgroundLuminances[i] : lum < backgroundLuminances[i]) return 1;
        return contrastRatio(hex, bg);
      });
    }
    function score(color) {
      return Math.min(...scores(color));
    }
    if (score(source) >= target) return;
    // For a generated mode, the reflected seed's gamut can be much smaller
    // than the original's (notably bright yellow and saturated blue). Use the
    // original color's chroma ceiling and saturation as the search anchor.
    const sourceChroma = anchors ? anchors[role].chroma : okhslChroma(source);
    const basis = anchors ? { ...source, s: anchors[role].saturation } : source;
    const extreme = candidateAt(basis, endpoint, sourceChroma);
    // The endpoint is always on the required side of every sRGB background.
    // Use actual WCAG ratios here, not the wrong-direction sentinel in scores().
    const extremeHex = okhslToHex(extreme);
    const extremeRatios = backgroundHexes.map(bg => contrastRatio(extremeHex, bg));
    const maxScore = Math.min(...extremeRatios);
    if (maxScore < target) {
      const limitingRoles = backgrounds.filter((_, i) => extremeRatios[i] <= maxScore + 1e-9);
      const selectedHex = okhslToHex(source);
      const actualContrast = Math.min(...backgroundHexes.map(bg => contrastRatio(selectedHex, bg)));
      const direction = mode === 'light' ? 'no lighter' : 'no darker';
      warnings.push(`${role}: ${target}:1 is not achievable while ${direction} than ${limitingRoles.join(', ')} (best ${maxScore.toFixed(2)}:1 in that direction; selected color minimum actual contrast ${actualContrast.toFixed(2)}:1 across checked surfaces); kept the selected color.`);
      return;
    }
    // Find the smallest movement toward the correct end of the scale. Evaluate
    // the quantized output too, so a displayed hex never barely misses a target.
    let from = source.l, to = endpoint;
    for (let i = 0; i < 25; i++) {
      const mid = (from + to) / 2;
      if (score(candidateAt(basis, mid, sourceChroma)) >= target) to = mid;
      else from = mid;
    }
    result[role] = candidateAt(basis, to, sourceChroma);
  }

  for (const [role, target] of Object.entries(surfaceTargets)) solve(role, target, ['bg']);
  for (const [role, target] of Object.entries(foregroundTargets)) {
    solve(role, target, role === 'tx' || role === 'tx-2' ? textSurfaces : backgroundSurfaces);
  }
  return { colors: result, warnings };
}
