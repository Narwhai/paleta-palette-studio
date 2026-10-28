import { okhslToHex, hexToOkhsl, contrastRatio } from './color.js';
import { optimizePalette } from './optimize.js';

const BASE = [
  ['bg', 'Background'], ['bg-2', 'Background 2'], ['ui', 'Interface'], ['ui-2', 'Interface 2'],
  ['ui-3', 'Interface 3'], ['tx-3', 'Text 3'], ['tx-2', 'Text 2'], ['tx', 'Text']
];
const ACCENTS = [
  ['red', 'Red'], ['orange', 'Orange'], ['yellow', 'Yellow'], ['green', 'Green'],
  ['cyan', 'Cyan'], ['blue', 'Blue'], ['purple', 'Purple'], ['magenta', 'Magenta']
];
const ROLES = [...BASE, ...ACCENTS];
const DEFAULT_HEX = {
  light: {
    bg: '#fffcf4', 'bg-2': '#f2f0e5', ui: '#e6e4d9', 'ui-2': '#cecdc3', 'ui-3': '#b7b5ac',
    'tx-3': '#878580', 'tx-2': '#6f6e69', tx: '#100f0f', red: '#af3029', orange: '#bc5215',
    yellow: '#ad8301', green: '#66800b', cyan: '#24837b', blue: '#205ea6', purple: '#5e409d', magenta: '#a02f6f'
  },
  dark: {
    bg: '#100f0f', 'bg-2': '#1c1b1a', ui: '#282726', 'ui-2': '#403e3c', 'ui-3': '#575653',
    'tx-3': '#878580', 'tx-2': '#b7b5ac', tx: '#cecdc3', red: '#d14d41', orange: '#da702c',
    yellow: '#d0a215', green: '#879a39', cyan: '#3aa99f', blue: '#4385be', purple: '#8b7ec8', magenta: '#ce5d97'
  }
};
const STORAGE_KEY = 'tone-palette-studio-v1';
const $ = (id) => document.getElementById(id);
const makeDefaults = () => Object.fromEntries(Object.entries(DEFAULT_HEX).map(([mode, colors]) => [mode, Object.fromEntries(Object.entries(colors).map(([role, hex]) => [role, hexToOkhsl(hex)]))]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const validColor = (color) => color && typeof color === 'object' && Number.isFinite(color.h) && Number.isFinite(color.s) && Number.isFinite(color.l) && color.h >= 0 && color.h <= 360 && color.s >= 0 && color.s <= 100 && color.l >= 0 && color.l <= 100;
const validPalettes = (palettes) => palettes && ['light', 'dark'].every((mode) => palettes[mode] && ROLES.every(([role]) => validColor(palettes[mode][role])));
let state = { mode: 'light', selected: 'bg', palettes: makeDefaults() };
let undo = { light: null, dark: null };
let persistenceWarning = false;
let toastTimer;

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (validPalettes(parsed.palettes) && ['light', 'dark'].includes(parsed.mode) && ROLES.some(([role]) => role === parsed.selected)) {
      state = { mode: parsed.mode, selected: parsed.selected, palettes: parsed.palettes };
    } else {
      persistenceWarning = true;
    }
  }
} catch {
  persistenceWarning = true;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    if (!persistenceWarning) toast('Could not save locally. Export your palette to keep it.');
    persistenceWarning = true;
  }
}

const buttons = new Map();
for (const [group, container] of [[BASE, $('base-swatches')], [ACCENTS, $('accent-swatches')]]) {
  for (const [role, name] of group) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    const sample = document.createElement('span');
    sample.className = 'swatch-sample';
    sample.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'swatch-name';
    label.textContent = name;
    const hex = document.createElement('span');
    hex.className = 'swatch-hex';
    button.append(sample, label, hex);
    button.addEventListener('click', () => {
      state.selected = role;
      $('hex-help').textContent = '';
      $('hex-input').setCustomValidity('');
      render();
      save();
    });
    container.append(button);
    buttons.set(role, { button, sample, hex });
  }
}

function gradient(makeColor) {
  const stops = [];
  for (let index = 0; index <= 12; index++) {
    const position = index / 12;
    stops.push(`${okhslToHex(makeColor(position))} ${Math.round(position * 100)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function render() {
  const colors = state.palettes[state.mode];
  const color = colors[state.selected];
  const currentHex = okhslToHex(color);
  const previews = [$('theme-preview').querySelector('.preview-app'), $('code-preview')];
  for (const [role, name] of ROLES) {
    const item = buttons.get(role);
    const hex = okhslToHex(colors[role]);
    item.sample.style.backgroundColor = hex;
    item.hex.textContent = hex.toUpperCase();
    item.button.setAttribute('aria-pressed', String(role === state.selected));
    item.button.setAttribute('aria-label', `${name}, ${hex}, ${role === state.selected ? 'selected' : 'select to edit'}`);
    for (const preview of previews) preview.style.setProperty(`--${role}`, hex);
  }
  $('mode-light').setAttribute('aria-pressed', String(state.mode === 'light'));
  $('mode-dark').setAttribute('aria-pressed', String(state.mode === 'dark'));
  $('palette-description').textContent = `${state.mode === 'light' ? 'Light' : 'Dark'} mode · 16 colors`;
  $('preview-mode').textContent = `${state.mode.toUpperCase()} MODE PREVIEW`;
  $('selected-sample').style.backgroundColor = currentHex;
  $('selected-sample').style.color = contrastRatio(currentHex, '#ffffff') >= 3 ? '#ffffffb0' : '#29282280';
  $('selected-name').textContent = ROLES.find(([role]) => role === state.selected)[1];
  $('selected-role').textContent = `${BASE.some(([role]) => role === state.selected) ? 'BASE' : 'ACCENT'} / ${state.selected.toUpperCase()}`;
  $('hex-input').value = currentHex.toUpperCase();
  $('hue').value = Math.round(color.h);
  $('saturation').value = Math.round(color.s);
  $('lightness').value = Math.round(color.l);
  $('hue-value').textContent = `${Math.round(color.h)}°`;
  $('saturation-value').textContent = `${Math.round(color.s)}%`;
  $('lightness-value').textContent = `${Math.round(color.l)}%`;
  // A fixed reference keeps the hue spectrum usable for grays and black/white.
  $('hue').style.background = gradient((position) => ({ h: position * 360, s: 75, l: 65 }));
  $('saturation').style.background = gradient((position) => ({ h: color.h, s: position * 100, l: color.l }));
  $('lightness').style.background = gradient((position) => ({ h: color.h, s: color.s, l: position * 100 }));
  $('contrast-bg').textContent = `${contrastRatio(currentHex, okhslToHex(colors.bg)).toFixed(2)}:1`;
  $('contrast-bg2').textContent = `${contrastRatio(currentHex, okhslToHex(colors['bg-2'])).toFixed(2)}:1`;
  $('undo-button').disabled = !undo[state.mode];
}

for (const [id, property] of [['hue', 'h'], ['saturation', 's'], ['lightness', 'l']]) {
  $(id).addEventListener('input', (event) => {
    state.palettes[state.mode][state.selected][property] = Number(event.target.value);
    $('hex-input').setCustomValidity('');
    $('hex-help').textContent = '';
    render();
    save();
  });
}

$('hex-input').addEventListener('input', () => {
  $('hex-input').setCustomValidity('');
  $('hex-help').textContent = '';
});
$('hex-input').addEventListener('change', (event) => {
  const input = event.target;
  let value = input.value.trim();
  if (!value.startsWith('#')) value = `#${value}`;
  if (!/^#[\da-f]{6}$/i.test(value)) {
    input.setCustomValidity('Enter a six-digit hex color, for example #FFFCF4.');
    $('hex-help').textContent = 'Use 6 hex digits.';
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  $('hex-help').textContent = '';
  state.palettes[state.mode][state.selected] = hexToOkhsl(value);
  render();
  save();
});

for (const mode of ['light', 'dark']) {
  $(`mode-${mode}`).addEventListener('click', () => {
    state.mode = mode;
    $('hex-input').setCustomValidity('');
    $('hex-help').textContent = '';
    $('optimizer-message').hidden = true;
    render();
    save();
  });
}

$('optimize-button').addEventListener('click', () => {
  try {
    const before = clone(state.palettes[state.mode]);
    const result = optimizePalette(before, state.mode);
    if (!result || !result.colors || !ROLES.every(([role]) => validColor(result.colors[role])) || !Array.isArray(result.warnings)) throw new Error('Invalid optimizer result');
    undo[state.mode] = clone(state.palettes[state.mode]);
    state.palettes[state.mode] = result.colors;
    const notice = $('optimizer-message');
    notice.textContent = result.warnings.length ? `Optimized with notes:\n${result.warnings.join('\n')}` : `${state.mode === 'light' ? 'Light' : 'Dark'} mode optimized. Continue adjusting any color, or undo.`;
    notice.hidden = false;
    render();
    save();
  } catch (error) {
    $('optimizer-message').hidden = false;
    $('optimizer-message').textContent = `Could not optimize this palette: ${error.message}. Your colors have not been changed.`;
  }
});
$('undo-button').addEventListener('click', () => {
  if (!undo[state.mode]) return;
  state.palettes[state.mode] = undo[state.mode];
  undo[state.mode] = null;
  $('optimizer-message').textContent = 'Optimization undone. Your previous colors are restored.';
  $('optimizer-message').hidden = false;
  render();
  save();
});
$('reset-button').addEventListener('click', () => {
  if (!window.confirm('Reset both light and dark palettes to their starting colors? This cannot be undone.')) return;
  state = { mode: 'light', selected: 'bg', palettes: makeDefaults() };
  undo = { light: null, dark: null };
  $('optimizer-message').hidden = true;
  $('hex-input').setCustomValidity('');
  $('hex-help').textContent = '';
  render();
  save();
  toast('Both palettes have been reset.');
});

function cssExport() {
  const block = (mode, selector) => `${selector} {\n${ROLES.map(([role]) => `  --color-${role}: ${okhslToHex(state.palettes[mode][role])};`).join('\n')}\n}`;
  return `/* Generated with Tone. Set data-theme="dark" on your document to use the dark palette. */\n${block('light', ':root,\n[data-theme="light"]')}\n\n${block('dark', '[data-theme="dark"]')}\n`;
}
function jsonExport() {
  const modes = Object.fromEntries(['light', 'dark'].map((mode) => [mode, Object.fromEntries(ROLES.map(([role]) => [role, { hex: okhslToHex(state.palettes[mode][role]), okhsl: state.palettes[mode][role] }]))]));
  return `${JSON.stringify({ name: 'Tone palette', colorSpace: 'OKHSL', modes }, null, 2)}\n`;
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function closeExport() {
  $('export-menu').hidden = true;
  $('export-toggle').setAttribute('aria-expanded', 'false');
}
$('export-toggle').addEventListener('click', () => {
  const open = $('export-menu').hidden;
  $('export-menu').hidden = !open;
  $('export-toggle').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.export-wrap')) closeExport();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('export-menu').hidden) {
    closeExport();
    $('export-toggle').focus();
  }
});
$('copy-css').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(cssExport());
    toast('CSS variables copied for both modes.');
  } catch {
    toast('Copy unavailable. Download the CSS instead.');
  }
  closeExport();
});
$('download-css').addEventListener('click', () => { download('tone-palette.css', cssExport(), 'text/css'); closeExport(); toast('CSS palette downloaded.'); });
$('download-json').addEventListener('click', () => { download('tone-palette.json', jsonExport(), 'application/json'); closeExport(); toast('JSON palette downloaded.'); });

render();
if (persistenceWarning) toast('Saved colors could not be loaded. Export your palette to keep it.');
