# Clypra — Internationalization (i18n) Rules
# Loaded automatically from .agents/rules/ by all agent tools.
# Supplements AGENTS.md and .agents/skills/i18n-localization-engineering/SKILL.md.

## 1. Zero Hardcoded UI Text
- Never hardcode user-facing strings directly in React JSX, tooltips, dialogs, status messages, error notifications, or native menus.
- All user-facing text must be rendered through the localization hook (`useI18n()` / `t("key")`).

## 2. Canonical Semantic Keys
- New translation keys must be defined with clear, domain-scoped hierarchical naming:
  - Format: `<domain>.<component>.<element>` (e.g. `timeline.toolbar.split`, `settings.audio.sampleRate`).
  - Common actions: `common.<verb>` (e.g. `common.save`, `common.cancel`).
- Keys must first be added to the canonical catalog: `src/i18n/catalogs/en.json`.

## 3. Strict 9-Locale Catalog Parity
- Clypra officially supports 9 first-party locales:
  - English (`en` — canonical)
  - Russian (`ru`)
  - Spanish (`es`)
  - Japanese (`ja`)
  - German (`de`)
  - French (`fr`)
  - Korean (`ko`)
  - Simplified Chinese (`zh-CN`)
  - Traditional Chinese (`zh-TW`)
- Every new key added to `en.json` must be added to all 8 translation catalogs with equivalent interpolation placeholders (e.g. `{count}`, `{name}`).
- Always execute `npm run i18n:check` to verify 100% key and placeholder parity before completing any task touching UI text.

## 4. Locale-Aware Formatting
- Never format numbers, percentages, dates, or time durations using simple string concatenation or hardcoded decimal separators.
- Always use the locale-aware formatters:
  - `Intl.NumberFormat(locale)` for decimal numbers and currencies.
  - `Intl.DateTimeFormat(locale)` for dates and calendar timestamps.
  - Clypra's timecode formatters for SMPTE frame-accurate time display.

## 5. Layout Resilience & Non-Latin Scripts
- Design UI containers to accommodate 30–40% text expansion common in German, French, and Russian.
- Ensure proper rendering for Cyrillic, CJK, and accented glyphs without clipping or truncation.
