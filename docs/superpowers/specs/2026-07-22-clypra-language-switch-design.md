# Clypra Interface Language Switch Design

## Goal

Add an interface-language control to Clypra settings. Users can switch between Simplified Chinese and English without restarting the app or losing the current editing state. The selected language persists across launches.

This design supersedes the fixed-language constraint in `2026-07-21-clypra-zh-cn-localization-design.md`. It does not change project content, media metadata, technical tokens, or Whisper transcription language.

## User Experience

- Add an "Interface Language" row to the existing Appearance settings tab.
- Present two choices: `简体中文` and `English`.
- Apply the selected language immediately across the launch screen, editor, settings, dialogs, properties, timeline, captions, and export UI.
- Default to Simplified Chinese for new and existing installations that have no saved language value.
- Save the choice in the existing `clypra-settings` persisted settings object.
- Keep existing project names, track names, media names, paths, URLs, codec names, and other user or technical data unchanged.

## Runtime Architecture

Define `UiLanguage` as `"zhCN" | "en"`. The i18n module owns a small external language store with read, write, and subscribe operations. Existing `t()` calls read the active language and fall back to the other catalog value when the selected translation is empty.

A React hook backed by `useSyncExternalStore` subscribes components to language changes. `App` subscribes once so ordinary descendants rerender. Translation-bearing `React.memo` boundaries also subscribe so memoization cannot leave stale text. Module-scope `t()` calls are replaced with message keys or render-time translation so labels are not frozen at startup.

Changing language must not remount the editor root. Using `key={language}`, reloading the window, or restarting the application is excluded because these approaches can discard transient editor state.

## Settings Integration

Extend `settingsStore` with:

- `language: UiLanguage`, defaulting to `zhCN`.
- `setLanguage(language)`, which updates persisted state and the i18n runtime.
- Persisted-state validation that accepts only `zhCN` and `en`; missing or invalid values fall back to `zhCN`.

Startup initialization applies the persisted language before the first React render and sets `document.documentElement.lang` to `zh-CN` or `en`. The Appearance tab uses the existing segmented-button visual pattern and does not add a new settings tab or component abstraction.

Date formatting follows the active UI language. Whisper's caption language remains independent.

## Catalog Changes

Add catalog entries for the interface-language label, descriptions, and both language names. The English UI uses each catalog entry's `en` value; the Chinese UI uses `zhCN`. Existing fallback and interpolation rules remain unchanged.

The current AST UI-string check remains mandatory in both languages. Local English UI text belongs in the catalog, not inline component literals.

## Verification

Automated checks cover:

- Chinese remains the default.
- Switching to English changes `t()` output and interpolation immediately.
- Both directions fall back when the selected catalog value is empty.
- Subscribers rerender on language changes, including a memoized boundary.
- The settings control changes the store and visible UI without remounting editor state.
- Missing, legacy, and invalid persisted values resolve to `zhCN`; valid English persists.
- `document.documentElement.lang` and locale-sensitive dates follow the selected language.
- Module-scope translated labels are removed or made render-time dynamic.

Run the focused tests first, then the full TypeScript, i18n scan, Vitest, Rust, build, signing, and macOS UI smoke checks already required by the localization plan.

## Installation Impact

The bundle identifier remains `com.clypra.editor`, version remains `1.1.1`, and user data remains at `/Users/kk/Library/Application Support/com.clypra.editor`. Installation still creates `/Applications/Clypra-English-1.1.1.app.backup` before replacing `/Applications/Clypra.app`.

Final smoke testing must switch Chinese to English and back while an editor project is open, confirm the timeline state remains intact, restart the installed app, and confirm the last selected language is restored.
