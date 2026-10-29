import { okhslToHex, hexToOkhsl, contrastRatio } from './color.js';
import { optimizePalette } from './optimize.js';
import { generateOppositePalette } from './generate.js';
import { generateBaseColors } from './base-generation.js';
import { serializeBase16 } from './base16.js';

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
let generationUndo = { light: null, dark: null };
let generationNotes = { light: null, dark: null };
let latestImport = 0;
let importPending = false;
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

function cancelPendingImport() {
  if (!importPending) return;
  latestImport++;
  importPending = false;
  const message = $('import-message');
  message.textContent = 'Import cancelled because the palette changed or a color edit was started while the file was loading. Please select the JSON file again.';
  message.hidden = false;
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

// The hue track is a fixed reference so it remains useful even for grays and
// black/white. Saturation and lightness tracks use the current OKHSL color.
const hueGradient = gradient((position) => ({ h: position * 360, s: 75, l: 65 }));
function renderSliders(prefix, color) {
  for (const [name, property, unit] of [['hue', 'h', '°'], ['saturation', 's', '%'], ['lightness', 'l', '%']]) {
    $(`${prefix}${name}`).value = Math.round(color[property]);
    $(`${prefix}${name}-value`).textContent = `${Math.round(color[property])}${unit}`;
  }
  $(`${prefix}hue`).style.background = hueGradient;
  $(`${prefix}saturation`).style.background = gradient((position) => ({ h: color.h, s: position * 100, l: color.l }));
  $(`${prefix}lightness`).style.background = gradient((position) => ({ h: color.h, s: color.s, l: position * 100 }));
}

function render() {
  const colors = state.palettes[state.mode];
  const color = colors[state.selected];
  const currentHex = okhslToHex(color);
  const previews = [$('theme-preview').querySelector('.preview-app'), $('code-preview'), $('mini-preview')];
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
  const destination = state.mode === 'light' ? 'dark' : 'light';
  $('generate-button').textContent = `Generate ${destination} from ${state.mode}`;
  $('generate-help').textContent = `Generate ${destination} from the current ${state.mode} palette. This replaces the ${destination} palette.`;
  $('undo-generation-button').disabled = !generationUndo[state.mode];
  const note = generationNotes[state.mode];
  const generationMessage = $('generation-message');
  if (note !== null && generationMessage.textContent !== note) generationMessage.textContent = note;
  generationMessage.hidden = note === null;
  $('preview-mode').textContent = `${state.mode.toUpperCase()} MODE PREVIEW`;
  $('selected-sample').style.backgroundColor = currentHex;
  $('selected-sample').style.color = contrastRatio(currentHex, '#ffffff') >= 3 ? '#ffffffb0' : '#29282280';
  $('selected-name').textContent = ROLES.find(([role]) => role === state.selected)[1];
  $('selected-role').textContent = `${BASE.some(([role]) => role === state.selected) ? 'BASE' : 'ACCENT'} / ${state.selected.toUpperCase()}`;
  $('hex-input').value = currentHex.toUpperCase();
  renderSliders('', color);
  $('contrast-bg').textContent = `${contrastRatio(currentHex, okhslToHex(colors.bg)).toFixed(2)}:1`;
  $('contrast-bg2').textContent = `${contrastRatio(currentHex, okhslToHex(colors['bg-2'])).toFixed(2)}:1`;
  $('undo-button').disabled = !undo[state.mode];
}

for (const [id, property] of [['hue', 'h'], ['saturation', 's'], ['lightness', 'l']]) {
  $(id).addEventListener('input', (event) => {
    const color = state.palettes[state.mode][state.selected];
    const value = Number(event.target.value);
    if (color[property] !== value) cancelPendingImport();
    color[property] = value;
    $('hex-input').setCustomValidity('');
    $('hex-help').textContent = '';
    render();
    save();
  });
}

$('hex-input').addEventListener('input', () => {
  cancelPendingImport();
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
  const color = hexToOkhsl(value);
  const previous = state.palettes[state.mode][state.selected];
  if (color.h !== previous.h || color.s !== previous.s || color.l !== previous.l) cancelPendingImport();
  state.palettes[state.mode][state.selected] = color;
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

$('generate-button').addEventListener('click', () => {
  const sourceMode = state.mode;
  const notice = $('generation-message');
  try {
    const result = generateOppositePalette(state.palettes[sourceMode], sourceMode);
    if (!result || !['light', 'dark'].includes(result.mode) || !result.colors || !ROLES.every(([role]) => validColor(result.colors[role])) || !Array.isArray(result.warnings)) throw new Error('Invalid generated palette');
    cancelPendingImport();
    generationUndo[result.mode] = {
      colors: clone(state.palettes[result.mode]),
      optimizationUndo: undo[result.mode] ? clone(undo[result.mode]) : null,
      notes: generationNotes[result.mode],
      // If this destination was last changed by base generation, keep that
      // undo available when the newly generated mode is undone.
      previousGenerationUndo: generationUndo[result.mode]?.operation === 'base' ? generationUndo[result.mode] : null,
      operation: 'mode'
    };
    // The prior optimization snapshot belongs to the replaced palette. Keep it
    // with the generation snapshot, but don't expose it for the new palette.
    undo[result.mode] = null;
    state.palettes[result.mode] = result.colors;
    state.mode = result.mode;
    $('optimizer-message').hidden = true;
    $('hex-input').setCustomValidity('');
    $('hex-help').textContent = '';
    generationNotes[result.mode] = result.warnings.length
      ? `Generated ${result.mode} from ${sourceMode}. Generation-time notes (may not reflect later edits or optimization):\n${result.warnings.join('\n')}`
      : `Generated ${result.mode} from ${sourceMode}. No generation-time notes; later edits or optimization can change contrast. Review the preview and your actual usage.`;
    render();
    save();
  } catch (error) {
    notice.textContent = `Could not generate the matching palette: ${error.message}. Your colors have not been changed.`;
    notice.hidden = false;
  }
});

$('undo-generation-button').addEventListener('click', () => {
  if (!generationUndo[state.mode]) return;
  cancelPendingImport();
  const snapshot = generationUndo[state.mode];
  state.palettes[state.mode] = snapshot.colors;
  generationUndo[state.mode] = snapshot.previousGenerationUndo || null;
  // Discard optimizations of the generated palette, then restore the undo
  // snapshot that belonged to the destination before it was replaced.
  undo[state.mode] = snapshot.optimizationUndo;
  generationNotes[state.mode] = snapshot.notes;
  $('optimizer-message').hidden = true;
  $('hex-input').setCustomValidity('');
  $('hex-help').textContent = '';
  render();
  save();
  const notice = $('generation-message');
  notice.textContent = `Generation undone. The previous ${state.mode} palette is restored.${snapshot.notes ? `\n${snapshot.notes}` : ''}`;
  notice.hidden = false;
});

// The dialog is a draft: neither picker changes the palette until Apply.
const baseDialog = $('base-dialog');
let baseDraft = null;
const baseAnchors = [['bg', 'base-bg-hex', 'base-bg-picker'], ['tx', 'base-tx-hex', 'base-tx-picker']];
function normalizedHex(value) {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[\da-f]{6}$/i.test(hex) ? hex.toLowerCase() : null;
}
function exactAnchor(hex) {
  const original = hexToOkhsl(hex);
  if (okhslToHex(original) === hex) return original;
  // Rare sRGB boundary colors can round-trip one channel off because of the
  // numerical OKHSL gamut approximation. Try nearby bounded coordinates so
  // the selected, displayed hex remains exact rather than silently changing.
  const offsets = [0, -0.001, 0.001, -0.01, 0.01, -0.05, 0.05, -0.1, 0.1];
  for (const dl of offsets) for (const ds of offsets) for (const dh of offsets) {
    const l = original.l + dl, s = original.s + ds;
    if (l < 0 || l > 100 || s < 0 || s > 100) continue;
    const color = { h: (original.h + dh + 360) % 360, s, l };
    if (okhslToHex(color) === hex) return color;
  }
  throw new Error(`The selected color ${hex.toUpperCase()} cannot be represented exactly; please choose a nearby color`);
}
function updateBasePreview() {
  const background = normalizedHex($('base-bg-hex').value);
  const text = normalizedHex($('base-tx-hex').value);
  if (!background || !text) {
    $('base-anchor-contrast').textContent = 'Enter two six-digit hex colors to preview their contrast.';
    return;
  }
  const preview = $('base-anchor-preview');
  preview.style.backgroundColor = background;
  preview.style.color = text;
  $('base-anchor-contrast').textContent = `Selected text on background: ${contrastRatio(background, text).toFixed(2)}:1. The base generator targets 7:1 for primary text where possible.`;
}
$('base-generate-button').addEventListener('click', () => {
  const mode = state.mode;
  const colors = state.palettes[mode];
  baseDraft = {
    mode,
    anchors: { bg: clone(colors.bg), tx: clone(colors.tx) },
    colors: { bg: clone(colors.bg), tx: clone(colors.tx) },
    paletteSnapshot: JSON.stringify(state.palettes)
  };
  for (const [role, hexId, pickerId] of baseAnchors) {
    const hex = okhslToHex(baseDraft.anchors[role]);
    $(hexId).value = hex.toUpperCase();
    $(hexId).setCustomValidity('');
    $(pickerId).value = hex;
    renderSliders(`base-${role}-`, baseDraft.colors[role]);
  }
  $('base-dialog-mode').textContent = `EDITING ${mode.toUpperCase()} MODE`;
  $('base-dialog-error').hidden = true;
  $('base-dialog-import-notice').hidden = true;
  updateBasePreview();
  baseDialog.showModal();
  $('base-bg-hex').focus();
});
function cancelImportForBaseDraft() {
  if (!importPending) return;
  cancelPendingImport();
  // The ordinary import status lives behind the modal; repeat it here so the
  // user can hear/read why the file needs to be selected again.
  $('base-dialog-import-notice').textContent = $('import-message').textContent;
  $('base-dialog-import-notice').hidden = false;
}
function syncBaseHex(role, hexId, hex) {
  try {
    // Preserve precise coordinates when the displayed hex still matches the
    // draft or the original anchor; otherwise use the exact hex conversion.
    if (hex !== okhslToHex(baseDraft.colors[role])) {
      baseDraft.colors[role] = hex === okhslToHex(baseDraft.anchors[role])
        ? clone(baseDraft.anchors[role]) : exactAnchor(hex);
    }
    renderSliders(`base-${role}-`, baseDraft.colors[role]);
  } catch (error) {
    $(hexId).setCustomValidity(error.message);
    $('base-dialog-error').textContent = error.message;
    $('base-dialog-error').hidden = false;
  }
}
for (const [role, hexId, pickerId] of baseAnchors) {
  $(hexId).addEventListener('input', () => {
    if (!baseDraft) return;
    cancelImportForBaseDraft();
    $(hexId).setCustomValidity('');
    $('base-dialog-error').hidden = true;
    const hex = normalizedHex($(hexId).value);
    if (hex) {
      $(pickerId).value = hex;
      syncBaseHex(role, hexId, hex);
    }
    updateBasePreview();
  });
  $(pickerId).addEventListener('input', () => {
    if (!baseDraft) return;
    cancelImportForBaseDraft();
    const hex = $(pickerId).value.toLowerCase();
    $(hexId).value = hex.toUpperCase();
    $(hexId).setCustomValidity('');
    $('base-dialog-error').hidden = true;
    syncBaseHex(role, hexId, hex);
    updateBasePreview();
  });
  for (const [name, property] of [['hue', 'h'], ['saturation', 's'], ['lightness', 'l']]) {
    $(`base-${role}-${name}`).addEventListener('input', (event) => {
      if (!baseDraft) return;
      const value = Number(event.target.value);
      if (baseDraft.colors[role][property] !== value) cancelImportForBaseDraft();
      baseDraft.colors[role][property] = value;
      const hex = okhslToHex(baseDraft.colors[role]);
      $(hexId).value = hex.toUpperCase();
      $(pickerId).value = hex;
      $(hexId).setCustomValidity('');
      $('base-dialog-error').hidden = true;
      renderSliders(`base-${role}-`, baseDraft.colors[role]);
      updateBasePreview();
    });
  }
}
$('base-dialog-close').addEventListener('click', () => baseDialog.close());
$('base-cancel-button').addEventListener('click', () => baseDialog.close());
baseDialog.addEventListener('close', () => {
  baseDraft = null;
  $('base-generate-button').focus();
});
$('base-apply-button').addEventListener('click', () => {
  if (!baseDraft) return;
  for (const [, hexId] of baseAnchors) {
    const input = $(hexId);
    if (!normalizedHex(input.value)) {
      input.setCustomValidity('Enter a six-digit hex color, for example #FFFCF4.');
      $('base-dialog-error').textContent = 'Enter two valid six-digit hex colors.';
      $('base-dialog-error').hidden = false;
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
  }
  if (JSON.stringify(state.palettes) !== baseDraft.paletteSnapshot || state.mode !== baseDraft.mode) {
    $('base-dialog-error').textContent = 'The palette changed while this dialog was open. Close and reopen it to choose colors for the current palette.';
    $('base-dialog-error').hidden = false;
    return;
  }
  try {
    const mode = baseDraft.mode;
    const chosen = {};
    for (const [role, hexId] of baseAnchors) {
      const hex = normalizedHex($(hexId).value);
      // Slider edits keep precise OKHSL coordinates rather than round-tripping
      // through the quantized hex. Also handle a text value set without input.
      chosen[role] = hex === okhslToHex(baseDraft.colors[role]) ? clone(baseDraft.colors[role])
        : hex === okhslToHex(baseDraft.anchors[role]) ? clone(baseDraft.anchors[role]) : exactAnchor(hex);
    }
    const result = generateBaseColors(chosen.bg, chosen.tx);
    if (!result || !result.colors || !BASE.every(([role]) => validColor(result.colors[role])) || !Array.isArray(result.warnings)) throw new Error('Invalid generated base colors');
    cancelPendingImport();
    generationUndo[mode] = {
      colors: clone(state.palettes[mode]),
      optimizationUndo: undo[mode] ? clone(undo[mode]) : null,
      notes: generationNotes[mode],
      previousGenerationUndo: generationUndo[mode],
      operation: 'base'
    };
    undo[mode] = null;
    state.palettes[mode] = { ...state.palettes[mode], ...result.colors };
    $('optimizer-message').hidden = true;
    $('hex-input').setCustomValidity('');
    $('hex-help').textContent = '';
    generationNotes[mode] = result.warnings.length
      ? `Generated ${mode} base colors. Generation-time notes (may not reflect later edits or optimization):\n${result.warnings.join('\n')}\nAccents were unchanged; check their contrast against the new backgrounds.`
      : `Generated ${mode} base colors. No generation-time base contrast notes; later edits or optimization can change contrast. Accents were unchanged; check their contrast against the new backgrounds.`;
    render();
    save();
    baseDialog.close();
  } catch (error) {
    $('base-dialog-error').textContent = `Could not generate base colors: ${error.message}. Your colors have not been changed.`;
    $('base-dialog-error').hidden = false;
  }
});

$('optimize-button').addEventListener('click', () => {
  try {
    const before = clone(state.palettes[state.mode]);
    const result = optimizePalette(before, state.mode);
    if (!result || !result.colors || !ROLES.every(([role]) => validColor(result.colors[role])) || !Array.isArray(result.warnings)) throw new Error('Invalid optimizer result');
    cancelPendingImport();
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
  cancelPendingImport();
  state.palettes[state.mode] = undo[state.mode];
  undo[state.mode] = null;
  $('optimizer-message').textContent = 'Optimization undone. Your previous colors are restored.';
  $('optimizer-message').hidden = false;
  render();
  save();
});
$('reset-button').addEventListener('click', () => {
  if (!window.confirm('Reset both light and dark palettes to their starting colors? This cannot be undone.')) return;
  cancelPendingImport();
  state = { mode: 'light', selected: 'bg', palettes: makeDefaults() };
  undo = { light: null, dark: null };
  generationUndo = { light: null, dark: null };
  generationNotes = { light: null, dark: null };
  $('optimizer-message').hidden = true;
  $('generation-message').hidden = true;
  $('hex-input').setCustomValidity('');
  $('hex-help').textContent = '';
  render();
  save();
  toast('Both palettes have been reset.');
});

// The small-screen preview uses the same colors and the same full previews; it
// does not duplicate the editor state or the preview DOM.
const previewPane = $('preview-pane');
const previewToggle = $('preview-toggle');
const previewScroll = $('preview-scroll');
function setPreviewExpanded(expanded) {
  previewPane.setAttribute('data-expanded', String(expanded));
  previewToggle.setAttribute('aria-expanded', String(expanded));
  previewToggle.textContent = expanded ? 'Collapse preview ↓' : 'Expand preview ↑';
}
previewToggle.addEventListener('click', () => {
  setPreviewExpanded(previewToggle.getAttribute('aria-expanded') !== 'true');
});
// If keyboard focus moves back to the editor, don't leave it behind the
// expanded mobile panel. Focus itself stays on the user's chosen control.
document.addEventListener('focusin', (event) => {
  if (previewToggle.getAttribute('aria-expanded') === 'true' && window.matchMedia('(max-width: 900px)').matches && !previewPane.contains(event.target)) {
    setPreviewExpanded(false);
  }
});
for (const [button, section] of [['jump-app', 'app-preview-section'], ['jump-code', 'code-preview-section']]) {
  $(button).addEventListener('click', () => {
    const target = $(section);
    previewScroll.scrollTop += target.getBoundingClientRect().top - previewScroll.getBoundingClientRect().top;
    target.focus({ preventScroll: true });
  });
}

function cssExport() {
  const block = (mode, selector) => `${selector} {\n${ROLES.map(([role]) => `  --color-${role}: ${okhslToHex(state.palettes[mode][role])};`).join('\n')}\n}`;
  return `/* Generated with Tone. Set data-theme="dark" on your document to use the dark palette. */\n${block('light', ':root,\n[data-theme="light"]')}\n\n${block('dark', '[data-theme="dark"]')}\n`;
}
function jsonExport() {
  const modes = Object.fromEntries(['light', 'dark'].map((mode) => [mode, Object.fromEntries(ROLES.map(([role]) => [role, { hex: okhslToHex(state.palettes[mode][role]), okhsl: state.palettes[mode][role] }]))]));
  return `${JSON.stringify({ name: 'Tone palette', colorSpace: 'OKHSL', modes }, null, 2)}\n`;
}
function parsePaletteImport(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.colorSpace !== 'OKHSL' || !data.modes || typeof data.modes !== 'object' || Array.isArray(data.modes)) {
    throw new Error('Expected a Tone JSON export with OKHSL light and dark modes.');
  }
  const palettes = {};
  for (const mode of ['light', 'dark']) {
    const source = data.modes[mode];
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`Missing ${mode} mode.`);
    const colors = {};
    for (const [role] of ROLES) {
      const entry = source[role];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.hex !== 'string' || !/^#[\da-f]{6}$/i.test(entry.hex)) {
        throw new Error(`${mode} mode is missing a valid ${role} color.`);
      }
      if (!validColor(entry.okhsl)) throw new Error(`${mode} mode ${role} needs finite OKHSL values: hue 0–360, saturation and lightness 0–100.`);
      const { h, s, l } = entry.okhsl;
      colors[role] = { h, s, l };
    }
    palettes[mode] = colors;
  }
  return palettes;
}

$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  // Clear immediately so choosing the same file again triggers another change.
  event.target.value = '';
  if (!file) return;
  const request = ++latestImport;
  importPending = true;
  const message = $('import-message');
  message.textContent = 'Reading JSON palette…';
  message.hidden = false;
  let content;
  try {
    content = await file.text();
  } catch {
    if (request !== latestImport) return;
    importPending = false;
    message.textContent = 'Could not read that file. Please choose it again. Your colors have not been changed.';
    message.hidden = false;
    return;
  }
  // A slower earlier file must not overwrite a later selection or edit.
  if (request !== latestImport) return;
  importPending = false;
  let palettes;
  try {
    palettes = parsePaletteImport(content);
  } catch (error) {
    message.textContent = `${error.message} Your colors have not been changed.`;
    message.hidden = false;
    return;
  }
  state.palettes = palettes;
  undo = { light: null, dark: null };
  generationUndo = { light: null, dark: null };
  generationNotes = { light: null, dark: null };
  $('optimizer-message').hidden = true;
  $('generation-message').hidden = true;
  $('hex-input').setCustomValidity('');
  $('hex-help').textContent = '';
  render();
  save();
  message.textContent = 'Imported both light and dark palettes. You can continue editing.';
  message.hidden = false;
});

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
  if (baseDialog.open) return; // Native dialog handles Escape and focus.
  if (event.key === 'Escape' && !$('export-menu').hidden) {
    closeExport();
    $('export-toggle').focus();
  } else if (event.key === 'Escape' && previewToggle.getAttribute('aria-expanded') === 'true' && window.matchMedia('(max-width: 900px)').matches) {
    setPreviewExpanded(false);
    previewToggle.focus();
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
for (const mode of ['light', 'dark']) {
  $(`download-base16-${mode}`).addEventListener('click', () => {
    try {
      const yaml = serializeBase16(state.palettes[mode], mode);
      download(`tone-base16-${mode}.yaml`, yaml, 'application/yaml;charset=utf-8');
      toast(`Base16-style ${mode} palette downloaded.`);
    } catch (error) {
      toast(`Could not export Base16-style ${mode}: ${error.message}`);
    }
    closeExport();
    $('export-toggle').focus();
  });
}

render();
if (persistenceWarning) toast('Saved colors could not be loaded. Export your palette to keep it.');
