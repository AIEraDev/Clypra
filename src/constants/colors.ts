/**
 * Canonical semantic color references for code that needs to coordinate with
 * the CSS design system. Theme palettes are applied by settingsStore; UI and
 * canvas-adjacent code should consume these roles instead of inventing a new
 * color locally.
 */
export const CLYPRA_COLOR_TOKENS = {
  surface: {
    app: "var(--clypra-surface-app)",
    workspace: "var(--clypra-surface-workspace)",
    panel: "var(--clypra-surface-panel)",
    elevated: "var(--clypra-surface-elevated)",
    floating: "var(--clypra-surface-floating)",
    input: "var(--clypra-surface-input)",
  },
  text: {
    primary: "var(--clypra-text-primary)",
    secondary: "var(--clypra-text-secondary)",
    tertiary: "var(--clypra-text-tertiary)",
    disabled: "var(--clypra-text-disabled)",
  },
  border: {
    subtle: "var(--clypra-border-subtle)",
    default: "var(--clypra-border-default)",
    strong: "var(--clypra-border-strong)",
  },
  interaction: {
    hover: "var(--clypra-interaction-hover)",
    active: "var(--clypra-interaction-active)",
    selected: "var(--clypra-interaction-selected)",
    focus: "var(--clypra-interaction-focus)",
  },
  status: {
    success: "var(--clypra-status-success)",
    warning: "var(--clypra-status-warning)",
    error: "var(--clypra-status-error)",
    info: "var(--clypra-status-info)",
  },
  editor: {
    playhead: "var(--clypra-editor-playhead)",
    selection: "var(--clypra-editor-selection)",
    snap: "var(--clypra-editor-snap)",
    drop: "var(--clypra-editor-drop)",
  },
  clip: {
    video: "var(--clypra-clip-video-bg)",
    audio: "var(--clypra-clip-audio-bg)",
    image: "var(--clypra-clip-image-bg)",
    text: "var(--clypra-clip-text-bg)",
    effect: "var(--clypra-clip-effect-bg)",
    compound: "var(--clypra-clip-compound-bg)",
    sticker: "var(--clypra-clip-sticker-bg)",
    foreground: "var(--clypra-clip-fg)",
    audioWave: "var(--clypra-clip-audio-wave)",
  },
} as const;

/**
 * The only bridge from persisted/theme-editor names to the runtime palette.
 * Keeping this map here prevents CSS, React, and the theme editor from each
 * creating a different interpretation of the same color.
 */
export const CLYPRA_THEME_SOURCE_ALIASES = {
  "--color-bg": "--clypra-theme-bg",
  "--color-surface": "--clypra-theme-surface",
  "--color-surface-raised": "--clypra-theme-surface-raised",
  "--color-surface-panel": "--clypra-theme-surface-panel",
  "--color-surface-floating": "--clypra-theme-surface-floating",
  "--color-border": "--clypra-theme-border",
  "--color-border-soft": "--clypra-theme-border-soft",
  "--color-accent": "--clypra-theme-accent",
  "--color-accent-soft": "--clypra-theme-accent-soft",
  "--color-text-primary": "--clypra-theme-text-primary",
  "--color-text-muted": "--clypra-theme-text-muted",
  "--color-danger": "--clypra-theme-danger",
} as const;

/** Legacy clip names resolve to the active canonical clip palette. */
export const CLYPRA_LEGACY_COLOR_ALIASES = {
  "--color-video-clip": "var(--clypra-clip-video-bg)",
  "--color-audio-clip": "var(--clypra-clip-audio-bg)",
  "--color-text-clip": "var(--clypra-clip-text-bg)",
} as const;

/** shadcn compatibility names are aliases into the same semantic roles. */
export const CLYPRA_SHADCN_COLOR_ALIASES = {
  "--background": "var(--clypra-surface-app)",
  "--foreground": "var(--clypra-text-primary)",
  "--card": "var(--clypra-surface-panel)",
  "--card-foreground": "var(--clypra-text-primary)",
  "--popover": "var(--clypra-surface-floating)",
  "--popover-foreground": "var(--clypra-text-primary)",
  "--primary": "var(--clypra-interaction-focus)",
  "--primary-foreground": "var(--clypra-surface-app)",
  "--secondary": "var(--clypra-surface-elevated)",
  "--secondary-foreground": "var(--clypra-text-primary)",
  "--muted": "var(--clypra-surface-elevated)",
  "--muted-foreground": "var(--clypra-text-secondary)",
  "--accent": "var(--clypra-interaction-focus)",
  "--accent-foreground": "var(--clypra-surface-app)",
  "--destructive": "var(--clypra-status-error)",
  "--destructive-foreground": "var(--clypra-text-primary)",
  "--border": "var(--clypra-border-default)",
  "--input": "var(--clypra-surface-input)",
  "--ring": "var(--clypra-interaction-focus)",
} as const;

/** Backwards-compatible semantic names for older consumers. */
export const COLORS = {
  BG: CLYPRA_COLOR_TOKENS.surface.app,
  RAIL: CLYPRA_COLOR_TOKENS.surface.panel,
  BORDER: CLYPRA_COLOR_TOKENS.border.default,
  ACCENT: CLYPRA_COLOR_TOKENS.interaction.focus,
  TEXT_ORANGE: CLYPRA_COLOR_TOKENS.status.warning,
  VIDEO_TEAL: CLYPRA_COLOR_TOKENS.clip.video,
  WHITE: CLYPRA_COLOR_TOKENS.text.primary,
} as const;
