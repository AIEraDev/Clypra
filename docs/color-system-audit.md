# Clypra color system

This is the contract for every color rendered by the application UI. The
system has one runtime palette source and one semantic vocabulary. Components
must consume semantic roles; they must not introduce a local hex, RGB, HSL,
Tailwind rainbow, or fallback color.

## Sources of truth

| Layer | Location | Responsibility |
| --- | --- | --- |
| Theme palette input | `src/store/settingsStore.ts` | Stores the complete preset/custom palette selected by the user. |
| Runtime palette bridge | `src/constants/colors.ts` + `applyTheme()` | Maps persisted `--color-*` names to canonical `--clypra-theme-*` variables. Legacy names are aliases, never independent values. |
| Semantic roles and recipes | `src/index.css` | Defines surfaces, text, borders, status, editor indicators, and deterministic clip recipes. |
| TypeScript consumers | `src/constants/colors.ts` | Exposes `CLYPRA_COLOR_TOKENS` for canvas, DOM style, and non-utility code. |

`--clypra-theme-*` is the only palette value read by semantic CSS. The older
`--color-*` variables remain for compatibility with existing utilities and
theme-editor persistence, but `applyTheme()` writes them as `var(...)` aliases.
This prevents two values from representing the same role.

## Semantic vocabulary

- `surface.*`: app, workspace, panel, elevated, floating, and input surfaces.
- `text.*`: primary, secondary, tertiary, and disabled text.
- `border.*`: subtle, default, and strong separators.
- `interaction.*`: hover, active, selected, and focus states.
- `status.*`: success, warning, error, and info feedback.
- `editor.*`: playhead, selection, snap, and drop indicators.
- `clip.*`: stable media-family backgrounds, foreground, and audio waveform.

Use the equivalent utility (`bg-surface-panel`, `text-text-secondary`,
`border-border`, `text-status-error`, etc.) or import
`CLYPRA_COLOR_TOKENS` when a CSS color value is required.

## Deterministic clip rule

Clip identity is generated from a shared recipe in `src/index.css`:

```text
clip background = HSL(family hue, shared saturation, shared lightness)
```

Video, audio, image, text, effect, compound, and sticker families have stable
hues. Audio uses the green-teal family and a separate bright waveform token,
so the clip body and waveform remain visible against every timeline surface.
Selection is not encoded by inventing another clip color: it uses the shared
focus border and inner ring.

## What is prohibited

- Hex/RGB/HSL/OKLCH literals in UI components, JSX styles, or utility classes.
- `text-white`, `bg-black`, or arbitrary palette utilities used as UI roles.
- A second semantic palette in a component, feature, or theme preset.
- Per-theme overrides that replace deterministic clip backgrounds.
- CSS-variable fallbacks that contain a second color value, such as
  `var(--accent, #...)`.

When a color is genuinely user-authored content—text-template fill/stroke,
canvas background stops, imported media pixels, color-wheel output, or shader
parameters—it must remain data, not UI chrome. It should be defined in the
feature's canonical content-palette module and never be reused as an app
surface or status color.

## Review checklist

1. Search the changed file for `#`, `rgb(`, `hsl(`, `oklch(`, and arbitrary
   Tailwind color utilities.
2. Replace UI literals with a semantic role or a `CLYPRA_COLOR_TOKENS` value.
3. Verify selected, hover, disabled, error, and focus states still use shared
   interaction/status tokens.
4. For timeline clips, verify the body, label, waveform, and selection outline
   are all readable on the active theme.
5. Run `npm run typecheck`, `npm run build`, and the relevant Vitest suite.

The graphite/cool-cyan dark palette is the default preset. Alternate themes
change the palette input, not the component vocabulary or clip algorithm.
