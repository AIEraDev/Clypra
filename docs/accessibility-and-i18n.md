# Accessibility & Internationalization Architecture

## Internationalization (i18n) Scope Statement

### Stated Language Policy
- **Primary Source Language**: English (`en`) is the canonical authoring language for all user interface strings, command labels, settings, error messages, and documentation.
- **First-Party Supported Locales**:
  - English (`en`)
  - Traditional Chinese (`zh-TW`)
  - Simplified Chinese (`zh-CN`)
- **Implementation**: Managed centrally via `src/i18n/I18nProvider.tsx`.
- **Persistence**: User interface language selection is stored in `localStorage` under `clypra.language` and hydrated immediately upon application mount.
- **Scope Decision**: Clypra intentionally targets English and Chinese for its v1 desktop and web releases. Additional language expansions (Japanese, Spanish, German, French) are scheduled for subsequent community localization passes after core model freeze.

---

## Accessibility (A11y) Standards

### Keyboard Navigation (WCAG 2.1 AA Compliant)
1. **Timeline Clip Traversal**:
   - `Tab` / `Shift + Tab`: Moves focus sequentially through all clips across unlocked timeline tracks. Locked tracks are automatically skipped (`tabIndex={-1}`).
   - Visible Focus Indicator: High-contrast accent ring (`focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:outline-none`).
2. **Keyboard Interaction Controls**:
   - `Enter` / `Space`: Selects focused clip.
   - `Shift + Enter` / `Shift + Space` (or `Cmd`/`Ctrl`): Toggles multi-clip selection.
   - `Escape`: Deselects active clip selection.
   - `ContextMenu` / `Shift + F10`: Opens contextual menu at the visual center of the clip.
   - `Alt + ArrowLeft` / `Alt + ArrowRight`: Nudges clip start time left/right by 1 frame (1/30s).
   - `Alt + Shift + ArrowLeft` / `Alt + Shift + ArrowRight`: Nudges clip start time left/right by 1 second (30 frames).
3. **Screen Reader Compatibility**:
   - Explicit `role="button"` on interactive elements.
   - Comprehensive `aria-label` declaring clip name, track ID, start time, duration, locked state, selection state, and offline status.
   - Dynamic attributes: `aria-selected`, `aria-disabled`, `aria-haspopup="menu"`.
