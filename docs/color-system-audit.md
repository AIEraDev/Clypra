# Clypra color-system audit

The editor now uses a semantic color layer in `src/index.css`. Theme presets
continue to provide the existing `--color-*` values through
`src/store/settingsStore.ts`; semantic tokens reference those values so a
preset can change hue without reintroducing component-local palettes.

## Audit summary

| Current source | Observed usage | Semantic destination |
| --- | --- | --- |
| `--color-bg`, `--color-surface-panel` | App shell, workspace, preview chrome | `surface.app`, `surface.workspace` |
| `--color-surface`, `--color-surface-raised`, `--color-surface-floating` | Panels, cards, inputs, menus, dialogs | `surface.panel`, `surface.elevated`, `surface.floating`, `surface.input` |
| `--color-border`, `--color-border-soft` | Panel separators, controls, timeline dividers | `border.subtle`, `border.default`, `border.strong` |
| `--color-text-primary`, `--color-text-muted` | Headings, labels, metadata, disabled UI | `text.primary`, `text.secondary`, `text.tertiary`, `text.disabled` |
| `--color-accent` and shadcn `--primary`/`--ring` | Actions, focus, selected tabs, playhead-adjacent UI | `interaction.focus`, `interaction.selected`, `editor.selection` |
| `--color-danger`, raw red/green/amber classes | Errors, warnings, success indicators | `status.error`, `status.warning`, `status.success`, `status.info` |
| `--color-timeline-*` | Timeline ruler, tracks, filmstrips, waveform containers | `editor.timeline.*` |
| Raw clip violet/orange/indigo/amber values in `Clip.tsx` | Clip type identity | `clip.video`, `clip.audio`, `clip.image`, `clip.text`, `clip.effect`, `clip.compound`, `clip.sticker` |
| Preview shader gradients and marker color choices | Media/content authoring and user-selected markers | Intentional content colors; not application chrome |

## Decisions

- The default workspace palette is graphite with a low-saturation cool-cyan
  accent: `#0b0e12`, `#12171d`, `#1a2028`, `#27313b`, `#5ab8d4`.
- Clip colors stay dark and moderately saturated. Hue identifies media type;
  selection is always expressed by the shared accent outline and inner ring.
- Timeline and preview chrome inherit application surfaces. Media pixels and
  creative background shaders remain independent of the UI accent.
- Focus uses the same accent everywhere. Warning uses a muted amber, success
  a restrained green, and errors retain a clear red for recognition.
- Existing alternate themes remain supported by aliasing semantic tokens to
  their preset values. This avoids duplicating component-specific light/dark
  definitions.

## Remaining intentional exceptions

Canvas background shader palettes, color wheels, marker swatches, and imported
media colors are content or authoring controls. They should not be collapsed
into the application chrome palette.

Further cleanup candidates are raw utility colors in older launch/settings
surfaces and native/canvas drawing code. They are lower-risk follow-up work;
the shared semantic layer now gives those surfaces a stable target token.
