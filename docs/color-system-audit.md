# Clypra color system audit

This is the review contract for the color system.

## Sources of truth

| Source | Owns |
| --- | --- |
| `UI_THEMES` in `src/store/settingsStore.ts` | Application chrome and editor structure |
| `CLIP_PALETTES` in `src/store/settingsStore.ts` | Every clip-specific color value |
| `applyTheme()` | The single UI + clip composition and canonical variable write |
| `src/index.css` | Semantic variable pointers and structural clip rules, never clip literals |
| `CLYPRA_COLOR_TOKENS` in `src/constants/colors.ts` | Typed runtime `var(--clypra-*)` references |

The `--color-*` names are compatibility names. They point at canonical
`--clypra-*` variables and are not another palette.

## Clip rule

All clip-local color must come from a role in `CLIP_PALETTES`. This includes
the obvious clip body colors and the less obvious filmstrip overlays,
waveform/envelope controls, keyframes, tooltips, drag previews, metadata, and
invalid-position border.

Clip components must not add:

- hex, RGB, HSL, or arbitrary color literals;
- `text-white`, `bg-black`, `border-white`, or generic rainbow utilities;
- a component-level fallback color;
- a second clip palette in CSS, React, or canvas code.

The only permitted color literals for clip UI are the explicit values inside
the corresponding `CLIP_PALETTES` blocks.

## Canonical runtime roles

`applyTheme` maps the source names in `CLIP_PALETTE_TOKEN_KEYS` to canonical
variables such as `--clypra-clip-video-bg`, `--clypra-clip-audio-wave`,
`--clypra-clip-envelope-line`, and `--clypra-clip-tooltip-text`.

DOM code uses those variables through semantic Tailwind aliases or inline
`var(--clypra-clip-...)` styles. Canvas code reads the same variables from
`getComputedStyle(document.documentElement)`. This keeps canvas and DOM clips
on the same active palette.

## Review checklist

1. Search changed clip files for `#`, `rgb(`, `hsl(`, `color-mix`, and generic
   color utilities.
2. If the color belongs to a clip, add a named role to
   `CLIP_PALETTE_TOKEN_KEYS` and every `CLIP_PALETTES` entry.
3. Wire the role once in `applyTheme` and consume its canonical variable.
4. Confirm no clip token was added to `UI_THEMES`.
5. Run typecheck and the focused theme-composition tests.
