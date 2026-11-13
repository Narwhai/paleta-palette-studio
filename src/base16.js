import { okhslToHex } from './color.js';

// Export every selected role once in its displayed order. These slots
// intentionally do not follow the foreground semantics of strict Base16.
const PALETTE_ROLES = [
  'bg', 'bg-2', 'ui', 'ui-2', 'ui-3', 'tx-3', 'tx-2', 'tx',
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'
];

/** Serialize one complete palette mode as a Base16-style YAML palette. */
export function serializeBase16(colors, mode, themeName) {
  if (mode !== 'light' && mode !== 'dark') throw new TypeError('Expected light or dark mode for Base16 export.');
  if (typeof themeName !== 'string' || !themeName.trim()) throw new TypeError('Expected a theme name for Base16 export.');
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) throw new TypeError('Expected a complete OKHSL palette for Base16 export.');
  for (const role of PALETTE_ROLES) {
    const color = colors[role];
    if (!color || typeof color !== 'object' || Array.isArray(color) ||
        !Number.isFinite(color.h) || color.h < 0 || color.h > 360 ||
        !Number.isFinite(color.s) || color.s < 0 || color.s > 100 ||
        !Number.isFinite(color.l) || color.l < 0 || color.l > 100) {
      throw new TypeError(`Expected a valid OKHSL color for ${role}.`);
    }
  }
  const scheme = `${themeName.trim()} ${mode === 'light' ? 'Light' : 'Dark'}`;
  const lines = [`scheme: ${JSON.stringify(scheme)}`, 'author: "Unknown (generated with Paleta)"'];
  for (const [index, role] of PALETTE_ROLES.entries()) {
    const slot = index.toString(16).toUpperCase().padStart(2, '0');
    lines.push(`base${slot}: "${okhslToHex(colors[role]).slice(1)}"`);
  }
  return `${lines.join('\n')}\n`;
}
