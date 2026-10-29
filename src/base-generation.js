import { contrastRatio, hexToOkhsl, okhslToHex, relativeLuminance } from './color.js';
import { srgb_transfer_function_inv } from './okhsl-reference.js';

const surfaceTargets = { 'bg-2': 1.04, ui: 1.08, 'ui-2': 1.14, 'ui-3': 1.22 };
const foregroundTargets = { tx: 7, 'tx-2': 4.5, 'tx-3': 3 };
const valid = color => color && Number.isFinite(color.h) && color.h >= 0 && color.h <= 360 && Number.isFinite(color.s) && color.s >= 0 && color.s <= 100 && Number.isFinite(color.l) && color.l >= 0 && color.l <= 100;
const copy = ({ h, s, l }) => ({ h, s, l });
const toLinear = hex => [1, 3, 5].map(i => srgb_transfer_function_inv(parseInt(hex.slice(i, i + 2), 16) / 255));
const toSrgb = value => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

/**
 * Derive six base roles between two fixed OKHSL anchors. Linear-sRGB mixing
 * stays inside the display gamut and gives a monotonic luminance ramp in either
 * polarity. Search and final checks use the actual displayed 8-bit hexes.
 */
export function generateBaseColors(background, text) {
  if (!valid(background) || !valid(text)) throw new TypeError('Background and text must be valid OKHSL colors.');
  const bg = copy(background), tx = copy(text);
  const bgHex = okhslToHex(bg), txHex = okhslToHex(tx);
  const bgLinear = toLinear(bgHex), txLinear = toLinear(txHex);
  const totalContrast = contrastRatio(bgHex, txHex);
  function mix(t) {
    if (t <= 0) return copy(bg);
    if (t >= 1) return copy(tx);
    const hex = '#' + bgLinear.map((v, i) => Math.round(Math.max(0, Math.min(1, toSrgb(v + (txLinear[i] - v) * t))) * 255).toString(16).padStart(2, '0')).join('');
    return hexToOkhsl(hex);
  }
  const hexAt = t => okhslToHex(mix(t));
  // Finds the first quantized candidate satisfying a monotonic contrast rule.
  function first(predicate) {
    if (predicate(hexAt(0))) return 0;
    if (!predicate(hexAt(1))) return null;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (predicate(hexAt(mid))) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  function surface(ratio) {
    const t = first(hex => contrastRatio(bgHex, hex) >= ratio);
    return mix(t === null ? 1 : t);
  }
  // If anchors cannot support all four surface levels, proportionally compress
  // the existing target ratios into the available range, reserving separation
  // for text. Do not invent or move the chosen anchor colors.
  const maxSurfaceRatio = Math.min(1.22, Math.sqrt(totalContrast));
  const surfaceScale = Math.min(1, Math.log(maxSurfaceRatio) / Math.log(1.22));
  const textSurfaceMax = totalContrast >= 7 ? Math.min(1.08, totalContrast / 7) : maxSurfaceRatio;
  const textSurfaceScale = Math.min(surfaceScale, Math.log(textSurfaceMax) / Math.log(1.08));
  const colors = { bg, tx };
  // Quantization can push a nominally feasible surface just over the 7:1
  // boundary. Keep a last verified in-gamut sample with sufficient tx contrast.
  let lastTextSafe = 0;
  if (totalContrast >= 7) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(txHex, hexAt(mid)) >= 7) lo = mid;
      else hi = mid;
    }
    lastTextSafe = lo;
  }
  for (const [role, target] of Object.entries(surfaceTargets)) {
    const textSurface = role === 'bg-2' || role === 'ui';
    const scale = textSurface ? textSurfaceScale : surfaceScale;
    colors[role] = surface(target ** Math.max(0, scale));
    if (textSurface && totalContrast >= 7 && contrastRatio(txHex, okhslToHex(colors[role])) < 7) colors[role] = mix(lastTextSafe);
  }
  const textPoints = {};
  for (const [role, target, backgrounds] of [
    ['tx-2', 4.5, ['bg', 'bg-2', 'ui']],
    ['tx-3', 3, ['bg', 'bg-2']]
  ]) {
    const t = first(hex => backgrounds.every(key => contrastRatio(hex, okhslToHex(colors[key])) >= target));
    if (t === null) {
      // When the requested contrast is impossible on this bounded ramp, use a
      // proportional share of the anchors' contrast instead of collapsing to tx.
      const fallbackRatio = totalContrast ** (Math.log(target) / Math.log(7));
      const fallback = first(hex => contrastRatio(bgHex, hex) >= fallbackRatio);
      textPoints[role] = fallback === null ? 1 : fallback;
    } else textPoints[role] = t;
    colors[role] = mix(textPoints[role]);
  }
  // A feasible 3:1 faint text and an infeasible 4.5:1 secondary text can
  // otherwise reverse their hierarchy. If the bounded ramp has room, move the
  // latter toward the fixed primary text; final checks below report any target
  // still unmet and any ordering that quantization makes indistinguishable.
  const bgLum = relativeLuminance(bgHex), txLum = relativeLuminance(txHex);
  const increasing = txLum >= bgLum;
  const betweenAnchors = lum => increasing ? lum > bgLum && lum < txLum : lum < bgLum && lum > txLum;
  const passes = (color, target, backgrounds) => backgrounds.every(key => contrastRatio(okhslToHex(color), okhslToHex(colors[key])) >= target);
  let text3Lum = relativeLuminance(okhslToHex(colors['tx-3']));
  // An 8-bit/OKHSL round trip can place a near-endpoint mixed color just past
  // the primary text in luminance. Try nearby interior samples without losing
  // a target that was already achieved.
  if (!betweenAnchors(text3Lum) && textPoints['tx-3'] > 0) {
    const hadTarget = passes(colors['tx-3'], 3, ['bg', 'bg-2']);
    let found = false;
    for (let i = 1; i <= 8192; i++) {
      const point = textPoints['tx-3'] * (1 - i / 8192);
      const candidate = mix(point), lum = relativeLuminance(okhslToHex(candidate));
      if (betweenAnchors(lum) && (!hadTarget || passes(candidate, 3, ['bg', 'bg-2']))) {
        textPoints['tx-3'] = point;
        colors['tx-3'] = candidate;
        text3Lum = lum;
        found = true;
        break;
      }
    }
    // No distinguishable bounded candidate meets the already-achieved target.
    // Do not place faint text beyond the chosen primary anchor; the final
    // diagnostics report any unmet ratio or identical displayed roles.
    if (!found) {
      colors['tx-3'] = copy(tx);
      textPoints['tx-3'] = 1;
      text3Lum = txLum;
    }
  }
  const text2Lum = relativeLuminance(okhslToHex(colors['tx-2']));
  if (increasing ? text2Lum <= text3Lum : text2Lum >= text3Lum) {
    const hadTarget = passes(colors['tx-2'], 4.5, ['bg', 'bg-2', 'ui']);
    let found = false;
    // Start around the middle, then check the remainder of the bounded
    // interval so a narrow quantized step isn't missed.
    for (let i = 0; i < 255; i++) {
      const fraction = (i < 128 ? i + 128 : i - 127) / 256;
      const candidate = mix(textPoints['tx-3'] + (1 - textPoints['tx-3']) * fraction);
      const lum = relativeLuminance(okhslToHex(candidate));
      if (betweenAnchors(lum) && (increasing ? lum > text3Lum : lum < text3Lum) && (!hadTarget || passes(candidate, 4.5, ['bg', 'bg-2', 'ui']))) {
        colors['tx-2'] = candidate;
        found = true;
        break;
      }
    }
    // If no distinct displayed value fits, avoid a reversed hierarchy by
    // sharing the primary endpoint and report the resulting collision below.
    if (!found && (!hadTarget || passes(tx, 4.5, ['bg', 'bg-2', 'ui']))) colors['tx-2'] = copy(tx);
  }
  const warnings = [];
  for (const [role, target] of Object.entries(surfaceTargets)) {
    const ratio = contrastRatio(okhslToHex(colors[role]), bgHex);
    if (ratio < target) warnings.push(`${role} on bg: ${ratio.toFixed(4)}:1 (below target ${target}:1). The fixed anchors or bounded blend do not allow this target; adjust the colors.`);
  }
  for (const [role, target] of Object.entries(foregroundTargets)) {
    const backgrounds = role === 'tx-3' ? ['bg', 'bg-2'] : ['bg', 'bg-2', 'ui'];
    for (const key of backgrounds) {
      const ratio = contrastRatio(okhslToHex(colors[role]), okhslToHex(colors[key]));
      if (ratio < target) warnings.push(`${role} on ${key}: ${ratio.toFixed(4)}:1 (below target ${target}:1). The fixed anchors or bounded blend do not allow this target; adjust the colors.`);
    }
  }
  const surfaces = ['bg', 'bg-2', 'ui', 'ui-2', 'ui-3'];
  for (let i = 1; i < surfaces.length; i++) {
    const a = surfaces[i - 1], b = surfaces[i];
    const aHex = okhslToHex(colors[a]), bHex = okhslToHex(colors[b]);
    const aLum = relativeLuminance(aHex), bLum = relativeLuminance(bHex);
    if (aHex === bHex || (increasing ? bLum <= aLum : bLum >= aLum)) warnings.push(`${a} and ${b} are not visibly ordered; adjust the fixed anchors or refine these roles.`);
  }
  const textRoles = ['bg', 'tx-3', 'tx-2', 'tx'];
  for (let i = 1; i < textRoles.length; i++) {
    const a = textRoles[i - 1], b = textRoles[i];
    const aHex = okhslToHex(colors[a]), bHex = okhslToHex(colors[b]);
    const aLum = relativeLuminance(aHex), bLum = relativeLuminance(bHex);
    if (aHex === bHex || (increasing ? bLum <= aLum : bLum >= aLum)) warnings.push(`${a} and ${b} are not visibly ordered; adjust the fixed anchors or refine these roles.`);
  }
  return { colors, warnings };
}
