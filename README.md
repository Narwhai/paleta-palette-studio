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
- The hue track is a fixed colorful reference so it remains useful even on gray, black and white. The saturation and lightness tracks show the selected color's actual range. Contrast values compare the current color against the two background roles.
- Near pure blue, the sRGB gamut is disconnected along a narrow Oklab hue/lightness ray. The bounded OKHSL saturation slider may therefore exhibit a localized jump; this preserves representation of `#0000ff` and valid colors.
- **Optimize** adjusts the current mode's colors using role-based WCAG contrast constraints. It solves interface roles before foregrounds. Targets against the main background are 1.04:1 (bg-2), 1.08:1 (ui), 1.14:1 (ui-2), and 1.22:1 (ui-3). Text at 7:1 and text 2 at 4.5:1 are checked against bg, bg-2, and ui; text 3 at 3:1 and each accent at 4.5:1 are checked against bg and bg-2. The preview uses ui-2 and ui-3 for borders and details, not as text backgrounds. The solver seeks colors no lighter than their checked backgrounds in light mode, and no darker in dark mode. If a target is impossible in that direction, the selected color is retained and a warning identifies the limiting role, the best ratio in the required direction, and the selected color's actual minimum contrast across its checked backgrounds. The contrast card shows only bg and bg-2. This WCAG-based solver approximates the role-based ideas in [System Theme](https://earendil.com/posts/system-theme/), rather than using the article's unpublished perceptual-contrast method; it is not an accessibility guarantee. Check contrast for your specific uses, including other backgrounds, and continue to refine. Undo restores the state before the most recent optimization in that mode, including any later edits.
- Export both modes as CSS variables or JSON; JSON contains the editable OKHSL values and hex equivalents. To keep tweaking a saved palette, choose **Import JSON** and select a JSON file exported by Tone. Import replaces both modes, preserves their editable OKHSL values, and clears optimization undo history. Invalid files leave the current palette untouched. Set `data-theme="dark"` on an element to activate the dark CSS variables. Copying CSS requires clipboard permission and a secure context (localhost is typically supported).
- Changes are saved in browser local storage when available. Export a backup before clearing browser data or changing browsers.
