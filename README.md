# Tone — a palette studio

A dependency-free browser app for making paired light and dark color themes with OKHSL. Each mode has eight base roles (two backgrounds, three interface levels and three text levels) and eight accent colors. The starting colors are inspired by [Flexoki](https://stephango.com/flexoki).

## Run locally

Requires Node.js. No installation or external assets are needed.

```sh
npm start
```

Open <http://localhost:3000>. Set `PORT` to use a different port. Run the color and optimizer checks with `npm test`.

## How to use

- Switch between **Light** and **Dark**; each mode has its own independently editable colors. Pick any swatch, adjust its OKHSL hue, saturation and lightness, or enter a six-digit hex value.
- The editor itself previews the current mode's palette as you edit, generate, optimize, import or undo colors. Use **Site theme** in the header to return to the neutral editor if a palette makes the controls hard to read; the dedicated previews continue to use your colors. This preference is saved locally when available.
- Switch between the **App preview** and **Code preview** tabs below the editor to see the same palette in different contexts. The tabs also support the Left, Right, Home and End keys.
- The hue track is a fixed colorful reference so it remains useful even on gray, black and white. The saturation and lightness tracks show the selected color's actual range. Contrast values compare the current color against the two background roles.
- Near pure blue, the sRGB gamut is disconnected along a narrow Oklab hue/lightness ray. The bounded OKHSL saturation slider may therefore exhibit a localized jump; this preserves representation of `#0000ff` and valid colors.
- **Generate base colors** opens a dialog for the current mode’s background (`bg`) and primary text (`tx`). Adjust either anchor with its OKHSL sliders, enter a hex color, or use the color picker; then select **Apply & generate**. Cancel or Escape makes no changes. The two chosen anchors stay fixed, and the other six base roles are derived along a linear-sRGB blend between them, then stored as editable OKHSL. The generator checks the displayed 8-bit colors against the base-role WCAG targets described below. If the fixed anchors or bounded blend cannot meet a target, it reports the actual ratio instead of changing the anchors or claiming success. For example, a 7:1 primary-text target on UI and a 1.08:1 UI target on BG together require at least 7.56:1 between the anchors in an ordered ramp. The current mode’s accents and the other mode are unchanged: check accent contrast separately after changing the base. **Undo generation** restores the previous palette and optimization history, removing later edits. This is an editable starting point, not a universal accessibility guarantee.
- **Generate dark from light** or **Generate light from dark** derives the other mode from the current palette and replaces that destination, then shows it for review. For each matching semantic role it reflects OKHSL lightness as `100 − lightness`, starts from the source hue and relative OKHSL saturation, and runs the destination's role-based optimizer with chroma capped at the original source color rather than the reflected seed. This is an editable starting point, not an exact inverse or an accessibility guarantee: reflection can produce near-black backgrounds or muted accents, and the same OKHSL saturation at a different lightness does not imply the same Oklab chroma. Check your actual usage and refine. The app reports any unmet contrast targets, reversed surface ordering, or roles that resolve to the same displayed hex rather than silently rearranging your choices. These are explicitly labeled generation-time notes and may no longer describe the palette after subsequent edits or optimization. **Undo generation** restores the destination's exact previous palette and its previous optimization undo, including removing later edits and optimizations to the generated palette. Generation and optimization have separate per-mode undo snapshots; the prior optimization undo is unavailable while the generated palette is active, but returns if generation is undone. Undo snapshots and generation-time notes are session-only and are cleared on import, reset, or reload.
- **Optimize** adjusts the current mode's colors using role-based WCAG contrast constraints. It solves interface roles before foregrounds. Targets against the main background are 1.04:1 (bg-2), 1.08:1 (ui), 1.14:1 (ui-2), and 1.22:1 (ui-3). Text at 7:1 and text 2 at 4.5:1 are checked against bg, bg-2, and ui; text 3 at 3:1 and each accent at 4.5:1 are checked against bg and bg-2. The preview uses ui-2 and ui-3 for borders and details, not as text backgrounds. The solver seeks colors no lighter than their checked backgrounds in light mode, and no darker in dark mode. If a target is impossible in that direction, the selected color is retained and a warning identifies the limiting role, the best ratio in the required direction, and the selected color's actual minimum contrast across its checked backgrounds. The contrast card shows only bg and bg-2. This WCAG-based solver approximates the role-based ideas in [System Theme](https://earendil.com/posts/system-theme/), rather than using the article's unpublished perceptual-contrast method; it is not an accessibility guarantee. Check contrast for your specific uses, including other backgrounds, and continue to refine. Undo restores the state before the most recent optimization in that mode, including any later edits.
- Export both modes as CSS variables or JSON; JSON contains the editable OKHSL values and hex equivalents. To keep tweaking a saved palette, choose **Import JSON** and select a JSON file exported by Tone. Import replaces both modes, preserves their editable OKHSL values, and clears optimization undo history. Invalid files leave the current palette untouched. Set `data-theme="dark"` on an element to activate the dark CSS variables. Copying CSS requires clipboard permission and a secure context (localhost is typically supported).
- Changes are saved in browser local storage when available. Export a backup before clearing browser data or changing browsers.

## Base16-style palette export

The export menu offers **Download Base16-style light** and **Download Base16-style dark**. Each downloads a separate YAML palette using the current colors in that mode, even if the other mode is selected. The files use the original [Base16 scheme format](https://github.com/chriskempson/base16/blob/39fb23df970d4d6190d000271dec260250986012/file.md): top-level `scheme`, `author`, and `base00`–`base0F`, with six-digit sRGB hex values without `#`. The `author` is explicitly recorded as `Unknown (generated with Tone)` because Tone does not collect an author. These are palette files, not directly installable application themes.

Every selected role is exported once, in Tone's displayed order, without changing or optimizing the colors:

| Slot | Tone role | Slot | Tone role |
| --- | --- | --- | --- |
| `base00` | `bg` | `base08` | `red` |
| `base01` | `bg-2` | `base09` | `orange` |
| `base02` | `ui` | `base0A` | `yellow` |
| `base03` | `ui-2` | `base0B` | `green` |
| `base04` | `ui-3` | `base0C` | `cyan` |
| `base05` | `tx-3` | `base0D` | `blue` |
| `base06` | `tx-2` | `base0E` | `purple` |
| `base07` | `tx` | `base0F` | `magenta` |

The slots deliberately follow Tone's palette order, not strict Base16 semantics: in particular, `base05` contains faint text (`tx-3`) rather than Base16's primary foreground. The final accent slot, conventionally brown or dark red in Base16, uses Tone's selected magenta. Strict Base16 themes may interpret these slots differently, so check the resulting colors and contrast for your intended use.
