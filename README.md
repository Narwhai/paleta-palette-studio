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
- **Optimize** adjusts the current mode's colors using role-based WCAG contrast constraints. It solves surfaces before foregrounds and reports any unachievable targets. Surface targets against the main background are 1.04:1 (bg-2), 1.08:1 (ui), 1.14:1 (ui-2), and 1.22:1 (ui-3). Against all five surfaces it targets 7:1 for text, 4.5:1 for text 2, 3:1 for text 3, and 4.5:1 for each accent. This WCAG-based solver approximates the role-based ideas in [System Theme](https://earendil.com/posts/system-theme/), rather than using the article's unpublished perceptual-contrast method; it is not an accessibility guarantee. Check contrast for your specific uses and continue to refine. Undo restores the state before the most recent optimization in that mode, including any later edits.
- Export both modes as CSS variables or JSON. Set `data-theme="dark"` on an element to activate the dark CSS variables. JSON contains hex and OKHSL values. Copying CSS requires clipboard permission and a secure context (localhost is typically supported).
- Changes are saved in browser local storage when available. Export a backup before clearing browser data or changing browsers.
