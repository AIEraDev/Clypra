# Theme composition

Clypra has two independent runtime layers:

- `uiTheme` owns application chrome, surfaces, borders, text, ruler, tracks,
  and editor interaction colors.
- `clipPalette` owns every color rendered inside or directly on a clip.

`applyTheme(uiTheme, clipPalette)` composes the two layers on `:root`. A UI
theme can therefore be paired with any clip palette without copying clip
colors into the UI theme.

## Single clip source of truth

`src/store/themeRegistry.ts` is the only place where theme and clip color
values are defined. `CLIP_PALETTES` is typed with `ClipPaletteTokens`, and
every palette must provide exactly the roles listed by
`CLIP_PALETTE_TOKEN_KEYS`.

The roles cover media bodies, media edges and text, filmstrip and waveform
visuals, translucent envelope fills and smooth envelope lines, keyframes,
tooltips, drag previews, metadata, and invalid-position borders.

The waveform remains a source-amplitude visualization while fades are edited;
fade shading is drawn as a separate overlay and does not compress waveform
bar height.

If a component needs a new clip color, add a named role to the token list and
provide it in every `CLIP_PALETTES` entry. Do not add a literal to the
component or to `UI_THEMES`.

The old `--color-video-clip`, `--color-audio-clip`, and
`--color-text-clip` names are compatibility aliases only. They contain no
palette values and are never entries in `CLIP_PALETTES`.

## Settings store organization

The settings modules have deliberately narrow responsibilities:

- `src/store/settingsTypes.ts` contains persisted state types and value
  unions. It has no runtime behavior.
- `src/store/themeRegistry.ts` contains UI themes, clip palettes, font
  metadata, validators, and the CSS variable composition functions.
- `src/store/settingsStore.ts` contains the Zustand state, actions,
  persistence, migration, and rehydration. It re-exports the registry so
  existing imports remain stable.

New settings state belongs in `settingsStore.ts` and `settingsTypes.ts`; new
theme or clip roles belong in `themeRegistry.ts`. Do not put palette values or
CSS application logic back into the state store.

## Runtime flow

1. `UI_THEMES[uiTheme]` and `CLIP_PALETTES[clipPalette]` are selected.
2. `applyTheme` writes the composed source tokens and maps clip roles to
   canonical `--clypra-clip-*` variables.
3. CSS, React styles, and canvas code consume those canonical variables.

`src/index.css` contains semantic pointers and clip-kind rules only. It does
not contain a fallback HSL recipe or a second hardcoded clip palette.

## Settings and persistence

The Appearance settings expose both pickers independently. The persisted
`clypra-settings` schema is version `2`; old settings migrate their previous
theme into both `uiTheme` and `clipPalette` when no separate palette exists.

## Adding a palette

1. Add its id to `ClipPalette`, `CLIP_PALETTE_IDS`, and `UI_THEME_IDS` when it
   is also a UI theme.
2. Add one fully typed value block to `CLIP_PALETTES`.
3. Add metadata to `CLIP_PALETTE_META`.

The settings UI picks it up automatically.
