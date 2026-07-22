# Clypra Interface Language Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Simplified Chinese / English setting that updates the full Clypra UI immediately without remounting the editor.

**Architecture:** Keep the existing catalog and `t()` API. Add a tiny external locale store and `useLanguage()` subscription in `src/i18n/index.ts`; persist the selected `UiLanguage` in the existing Zustand settings store. Rerender the ordinary tree from `App`, subscribe the four memoized UI barriers, and replace every module-scope `t()` call with message keys translated at render or function-call time.

**Tech Stack:** React 19, TypeScript 5.8, Zustand persist, `useSyncExternalStore`, Vitest, Testing Library, existing AST i18n scanner, Tauri 2.

---

## File structure

- `src/i18n/types.ts` — add the closed `UiLanguage` union.
- `src/i18n/index.ts` — active locale, setter, subscriber, React hook, locale-aware fallback.
- `src/i18n/index.test.ts` — language selection, fallback, interpolation, and memoized subscription tests.
- `src/store/settingsStore.ts` — persisted language, validation, DOM language synchronization.
- `src/i18n/catalogs/settings.ts` — language setting labels.
- `src/components/ui/SettingsModal.tsx` — existing Appearance-tab segmented language control.
- `src/App.tsx` — root locale subscription without remounting.
- `src/components/editor/{preview/PreviewPanel.tsx,timeline/Track.tsx,timeline/Clip.tsx,transform/TransformOverlay.tsx}` — locale subscription at memo barriers.
- `src/lib/timeline/timelineZoom.ts`, `src/lib/text/textAnimation.ts`, `src/components/ui/SuccessToast.tsx`, `src/components/editor/properties/TextAnimationControls.tsx`, `src/components/editor/properties/TransitionSection.tsx`, `src/components/editor/timeline/TransitionIndicator.tsx` — remove module-load translation freezing.
- `src/components/screens/LaunchScreen.tsx`, `src/components/ui/CrashRecoveryDialog.tsx` — locale-aware dates.
- `scripts/check-ui-strings.mjs` — reject imported `t()` calls outside a function body.
- Existing focused tests beside the affected modules — update expectations to switch languages at runtime.

## Task 1: Reactive i18n runtime

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Extend `src/i18n/index.test.ts` imports and reset locale after each test:

```ts
import { act, createElement, memo } from "react";
import { render, screen } from "@testing-library/react";

import {
  getLanguage,
  resolveMessage,
  setLanguage,
  t,
  useLanguage,
} from "./index";

afterEach(() => {
  setLanguage("zhCN");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
```

Add these behaviors:

```ts
test("switches existing catalog messages to English", () => {
  setLanguage("en");
  expect(getLanguage()).toBe("en");
  expect(t("common.save")).toBe("Save");
  expect(t("common.selectedCount", { count: 3 })).toBe("3 selected");
});

test("falls back in both language directions", () => {
  expect(resolveMessage({ en: "Open", zhCN: "" }, "test.open", {}, "zhCN")).toBe("Open");
  expect(resolveMessage({ en: "", zhCN: "打开" }, "test.open", {}, "en")).toBe("打开");
});

test("rerenders a memoized subscriber when language changes", () => {
  const Probe = memo(() => createElement("span", null, useLanguage()));
  render(createElement(Probe));
  expect(screen.getByText("zhCN")).toBeInTheDocument();

  act(() => setLanguage("en"));

  expect(screen.getByText("en")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/i18n/index.test.ts
```

Expected: FAIL because `getLanguage`, `setLanguage`, and `useLanguage` do not exist and `resolveMessage` has no language argument.

- [ ] **Step 3: Implement the minimal runtime**

Add to `src/i18n/types.ts`:

```ts
export type UiLanguage = "zhCN" | "en";
```

Update `src/i18n/index.ts` to keep `t()` compatible:

```ts
import { useSyncExternalStore } from "react";
import { messages } from "./catalogs";
import type { LocalizedMessage, MessageParams, UiLanguage } from "./types";

export type MessageKey = keyof typeof messages;

let activeLanguage: UiLanguage = "zhCN";
const languageListeners = new Set<() => void>();

export function getLanguage(): UiLanguage {
  return activeLanguage;
}

export function setLanguage(language: UiLanguage): void {
  if (language === activeLanguage) return;
  activeLanguage = language;
  languageListeners.forEach((listener) => listener());
}

export function subscribeLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export function useLanguage(): UiLanguage {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

export function resolveMessage(
  definition: Partial<LocalizedMessage> | undefined,
  key: string,
  params: MessageParams = {},
  language: UiLanguage = getLanguage(),
): string {
  const fallbackLanguage: UiLanguage = language === "zhCN" ? "en" : "zhCN";
  const selectedMessage = definition?.[language];
  const fallbackMessage = definition?.[fallbackLanguage];
  const message = selectedMessage?.trim()
    ? selectedMessage
    : fallbackMessage?.trim()
      ? fallbackMessage
      : key;

  return message.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (placeholder, name) => {
    const value = params[name];
    if (value !== undefined && value !== null) return String(value);
    if (import.meta.env.DEV) console.warn(`[i18n] Missing parameter "${name}" for "${key}"`);
    return placeholder;
  });
}

export function t(key: MessageKey, params: MessageParams = {}): string {
  return resolveMessage(messages[key], key, params);
}
```

- [ ] **Step 4: Run focused tests and type checking**

Run:

```bash
npm test -- --run src/i18n/index.test.ts
npx tsc --noEmit
```

Expected: all i18n tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/types.ts src/i18n/index.ts src/i18n/index.test.ts
git commit -m "feat: add reactive interface language runtime"
```

## Task 2: Persisted setting and Appearance control

**Files:**
- Modify: `src/store/settingsStore.ts`
- Modify: `src/i18n/catalogs/settings.ts`
- Modify: `src/components/ui/SettingsModal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/catalogs/settings-general.test.ts`

- [ ] **Step 1: Write failing persistence and UI tests**

In `src/i18n/catalogs/settings-general.test.ts`, import `act`, `setLanguage`, and reset both runtimes after each test:

```ts
import { act, createElement } from "react";
import { getLanguage, setLanguage, t } from "@/i18n";

afterEach(() => {
  act(() => {
    useSettingsStore.setState({ language: "zhCN" });
    setLanguage("zhCN");
  });
  document.documentElement.lang = "zh-CN";
  vi.restoreAllMocks();
});
```

Add tests:

```ts
test("persists only supported interface languages", () => {
  const merge = settingsStoreModule.mergePersistedSettings;
  const current = useSettingsStore.getState();

  expect(merge({ language: "en" }, current).language).toBe("en");
  expect(merge({ language: "fr" }, current).language).toBe("zhCN");
});

test("switches the open settings UI to English immediately", () => {
  render(createElement(SettingsModal, { isOpen: true, onClose: vi.fn() }));

  fireEvent.click(screen.getByRole("button", { name: "English" }));

  expect(useSettingsStore.getState().language).toBe("en");
  expect(getLanguage()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
  expect(screen.getByText("Interface Language")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -- --run src/i18n/catalogs/settings-general.test.ts
```

Expected: FAIL because `language`, `setLanguage`, and the language buttons are absent.

- [ ] **Step 3: Add catalog messages**

Add to `src/i18n/catalogs/settings.ts`:

```ts
"settings.appearance.language": { en: "Interface Language", zhCN: "界面语言" },
"settings.appearance.languageDescription": {
  en: "Change the Clypra interface language immediately.",
  zhCN: "立即切换 Clypra 界面语言。",
},
"settings.appearance.language.zhCN": { en: "Simplified Chinese", zhCN: "简体中文" },
"settings.appearance.language.en": { en: "English", zhCN: "English" },
```

- [ ] **Step 4: Persist and apply the language**

In `src/store/settingsStore.ts`, import the i18n runtime and type:

```ts
import { setLanguage as setI18nLanguage, type MessageKey } from "@/i18n";
import type { UiLanguage } from "@/i18n/types";
```

Add `language` and `setLanguage` to `SettingsStore`, default `language: "zhCN"`, and implement:

```ts
export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zhCN" || value === "en";
}

export function applyLanguage(language: UiLanguage): void {
  setI18nLanguage(language);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language === "zhCN" ? "zh-CN" : "en";
  }
}
```

Merge persisted data with:

```ts
const language = hasOwn(persistedState, "language")
  ? isUiLanguage(persistedState.language)
    ? persistedState.language
    : "zhCN"
  : currentState.language;
```

Return `language`, add the setter, and apply during rehydration and startup:

```ts
setLanguage: (language) => {
  const safeLanguage = isUiLanguage(language) ? language : "zhCN";
  set({ language: safeLanguage });
  applyLanguage(safeLanguage);
},
```

Call `applyLanguage(state.language)` in both `onRehydrateStorage` and `initSettings()`.

- [ ] **Step 5: Add the Appearance-tab control and root subscription**

In `AppearanceTab`, select `language` and `setLanguage` from `useSettingsStore`, then add this section before Themes:

```tsx
<section>
  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
    {t("settings.appearance.language")}
  </h3>
  <p className="mt-1 mb-3 text-[11px] text-text-muted">
    {t("settings.appearance.languageDescription")}
  </p>
  <div
    className="grid grid-cols-2 gap-2"
    role="group"
    aria-label={t("settings.appearance.language")}
  >
    {(["zhCN", "en"] as const).map((value) => (
      <button
        key={value}
        type="button"
        aria-pressed={language === value}
        onClick={() => setLanguage(value)}
        className={`rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors ${
          language === value
            ? "border-accent bg-accent/10 text-accent"
            : "border-white/6 text-text-muted hover:border-white/12 hover:text-text-primary"
        }`}
      >
        {t(`settings.appearance.language.${value}`)}
      </button>
    ))}
  </div>
</section>
```

In `src/App.tsx`, import `useLanguage` and call it as the first hook in `App`:

```ts
useLanguage();
```

Do not add `key={language}` and do not reload the window.

- [ ] **Step 6: Run focused tests and type checking**

```bash
npm test -- --run src/i18n/index.test.ts src/i18n/catalogs/settings-general.test.ts
npx tsc --noEmit
```

Expected: tests pass; clicking English changes the open modal immediately; TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/store/settingsStore.ts src/i18n/catalogs/settings.ts src/components/ui/SettingsModal.tsx src/App.tsx src/i18n/catalogs/settings-general.test.ts
git commit -m "feat: add persisted interface language setting"
```

## Task 3: Remove frozen translations and memo barriers

**Files:**
- Modify: `scripts/check-ui-strings.mjs`
- Modify: `src/lib/timeline/timelineZoom.ts`
- Modify: `src/lib/timeline/timelineZoom.test.ts`
- Modify: `src/components/editor/timeline/TimelineToolbar.tsx`
- Modify: `src/lib/text/textAnimation.ts`
- Modify: `src/components/editor/properties/TextAnimationControls.tsx`
- Modify: `src/components/editor/properties/TransitionSection.tsx`
- Modify: `src/components/editor/timeline/TransitionIndicator.tsx`
- Modify: `src/components/ui/SuccessToast.tsx`
- Modify: `src/components/editor/properties/__tests__/TextAnimationAndModesLocalization.test.tsx`
- Modify: `src/components/editor/preview/PreviewPanel.tsx`
- Modify: `src/components/editor/timeline/Track.tsx`
- Modify: `src/components/editor/timeline/Clip.tsx`
- Modify: `src/components/editor/transform/TransformOverlay.tsx`

- [ ] **Step 1: Make the scanner fail on module-scope translations**

Extend `scanSource()` with a second finding when an imported i18n `t()` call has no function-like ancestor. Add this self-test before scanning the repository:

```js
assert.deepEqual(
  scan(`import { t } from "@/i18n"; const label = t("message.key");`, "src/Fixture.ts"),
  ["src/Fixture.ts:1: module-scope t() freezes the interface language"],
);
assert.deepEqual(
  scan(`import { t } from "@/i18n"; const View = () => <span>{t("message.key")}</span>;`),
  [],
);
```

Run:

```bash
npm run check:i18n
```

Expected: FAIL and list the six current source groups containing module-scope `t()` calls.

- [ ] **Step 2: Replace module-scope translated values with message keys**

Use `MessageKey` for static metadata and call `t()` only inside functions/components:

```ts
const TIMELINE_TIER_LABEL_KEYS: Record<SpatialTier, MessageKey> = {
  [SpatialTier.L0]: "timeline.zoom.spatial.overview",
  [SpatialTier.L1]: "timeline.zoom.spatial.standard",
  [SpatialTier.L2]: "timeline.zoom.spatial.detail",
  [SpatialTier.L3]: "timeline.zoom.spatial.frame",
};

export function getTimelineTierLabel(tier: SpatialTier): string {
  return t(TIMELINE_TIER_LABEL_KEYS[tier]);
}
```

Apply the same pattern exactly:

- `timelineZoom.ts`: key maps plus `getTimelineTierLabel()`; translate temporal labels inside `getTimelineTemporalDetail()`.
- `textAnimation.ts`: replace `AnimationPreset.name` with `nameKey: MessageKey`; preserve type, duration, easing, and icon.
- `TextAnimationControls.tsx`: map `nameKey` through `t()` and create easing options inside the component.
- `TransitionSection.tsx`: store `{ value, labelKey }` outside; map to `{ value, label: t(labelKey) }` inside.
- `TransitionIndicator.tsx`: map transition types to `MessageKey`; call `t()` after lookup.
- `SuccessToast.tsx`: store `labelKey` in `variantConfig`; call `t(cfg.labelKey)` while rendering.

Update affected tests to call `setLanguage("zhCN")` in cleanup and assert Chinese, then switch to `en` and assert English from the same exports/functions.

- [ ] **Step 3: Subscribe memo barriers**

Import `useLanguage` and call it inside these memoized components:

```ts
useLanguage();
```

Exact targets:

- `PreviewPanelComponent`
- `TrackInner`
- `ClipInner`
- `TransformOverlay`

This deliberately invalidates only locale-sensitive memo barriers. Do not remove their memoization and do not change comparator logic.

- [ ] **Step 4: Run focused tests and scanner**

```bash
npm test -- --run src/i18n/index.test.ts src/lib/timeline/timelineZoom.test.ts src/components/editor/properties/__tests__/TextAnimationAndModesLocalization.test.tsx
npm run check:i18n
npx tsc --noEmit
```

Expected: focused tests pass; scanner reports zero untranslated or module-scope translation findings; TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-ui-strings.mjs src/lib/timeline/timelineZoom.ts src/lib/timeline/timelineZoom.test.ts src/components/editor/timeline/TimelineToolbar.tsx src/lib/text/textAnimation.ts src/components/editor/properties/TextAnimationControls.tsx src/components/editor/properties/TransitionSection.tsx src/components/editor/timeline/TransitionIndicator.tsx src/components/ui/SuccessToast.tsx src/components/editor/properties/__tests__/TextAnimationAndModesLocalization.test.tsx src/components/editor/preview/PreviewPanel.tsx src/components/editor/timeline/Track.tsx src/components/editor/timeline/Clip.tsx src/components/editor/transform/TransformOverlay.tsx
git commit -m "fix: keep translated editor labels reactive"
```

## Task 4: Locale-sensitive dates and final frontend verification

**Files:**
- Modify: `src/components/screens/LaunchScreen.tsx`
- Modify: `src/components/screens/LaunchScreen.test.tsx`
- Modify: `src/components/ui/CrashRecoveryDialog.tsx`
- Create: `src/components/ui/CrashRecoveryDialog.test.tsx`

- [ ] **Step 1: Write failing date-locale tests**

Export `formatLaunchProjectDate` from `LaunchScreen.tsx` and `formatRecoverySavedAt` from `CrashRecoveryDialog.tsx`. Add this pattern to `LaunchScreen.test.tsx` and the new `CrashRecoveryDialog.test.tsx`:

```ts
setLanguage("zhCN");
expect(formatLaunchProjectDate("2026-07-01T04:00:00.000Z")).toMatch(/[年月日]/);
expect(formatRecoverySavedAt("2026-07-01T04:00:00.000Z")).toMatch(/[年月日]/);

setLanguage("en");
expect(formatLaunchProjectDate("2026-07-01T04:00:00.000Z")).toMatch(/[A-Za-z]/);
expect(formatRecoverySavedAt("2026-07-01T04:00:00.000Z")).toMatch(/[A-Za-z]/);
```

Reset `setLanguage("zhCN")` after each test. The fixed timestamp is midday in the configured Asia/Shanghai timezone and avoids day rollover.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- --run src/components/screens/LaunchScreen.test.tsx src/components/ui/CrashRecoveryDialog.test.tsx
```

Expected: English assertions fail because both formatters hard-code `zh-CN`.

- [ ] **Step 3: Use the active UI locale**

Import `getLanguage` and derive inside each exported formatter:

```ts
const locale = getLanguage() === "zhCN" ? "zh-CN" : "en";
```

Use `locale` in both `Intl.DateTimeFormat` calls. Do not change `Intl.Segmenter("zh-CN")`; grapheme counting is language-neutral for the supported project-name characters and is not visible UI formatting.

- [ ] **Step 4: Run full frontend verification**

```bash
npm run check:i18n
npx tsc --noEmit
npm test -- --run
npm run build
```

Expected: i18n scan passes; TypeScript exits 0; all Vitest suites pass with only existing skips; Vite build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/screens/LaunchScreen.tsx src/components/screens/LaunchScreen.test.tsx src/components/ui/CrashRecoveryDialog.tsx src/components/ui/CrashRecoveryDialog.test.tsx
git commit -m "fix: format visible dates in the selected language"
```

## Task 5: Rust verification, rebuild, sign, install, and smoke test

**Files:**
- Do not commit generated files under `dist`, `node_modules`, or `src-tauri/target`.

- [ ] **Step 1: Verify Rust remains clean**

```bash
PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/lib/pkgconfig cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/lib/pkgconfig cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: 95 Rust tests pass, formatting passes, and Clippy reports no warnings.

- [ ] **Step 2: Rebuild and sign the localized bundle**

Quit every running Clypra process first, then run:

```bash
PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/lib/pkgconfig npm run tauri -- build --target aarch64-apple-darwin --bundles app --no-sign --config '{"bundle":{"createUpdaterArtifacts":false}}'
codesign --force --deep --sign - src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app
codesign --verify --deep --strict --verbose=2 src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app
```

Expected: arm64 app bundle builds and strict ad-hoc signature verification exits 0.

- [ ] **Step 3: Smoke-test the rebuilt bundle before installation**

Launch the build bundle. Open an editor project, open Settings > Appearance, switch to English, and verify launch/editor/settings/timeline/properties/captions/export labels update without closing the project. Switch back to Simplified Chinese and confirm the same project and timeline state remain.

Quit and relaunch the build bundle. Expected: the last selected language persists.

- [ ] **Step 4: Validate exact install targets**

```bash
test -d /Applications/Clypra.app
test ! -e /Applications/Clypra-English-1.1.1.app.backup
defaults read /Applications/Clypra.app/Contents/Info CFBundleShortVersionString
defaults read /Applications/Clypra.app/Contents/Info CFBundleIdentifier
defaults read src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app/Contents/Info CFBundleIdentifier
```

Expected: original version `1.1.1`; both identifiers `com.clypra.editor`; backup target absent.

- [ ] **Step 5: Back up and install**

After confirming no Clypra process remains:

```bash
mv /Applications/Clypra.app /Applications/Clypra-English-1.1.1.app.backup
ditto src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app /Applications/Clypra.app
codesign --verify --deep --strict --verbose=2 /Applications/Clypra.app
```

- [ ] **Step 6: Perform installed-app smoke tests**

Launch `/Applications/Clypra.app`. Verify existing projects remain, import media, place it on the timeline, open properties/captions/settings/export, switch English and Chinese with the project open, and restart once to verify persistence. Confirm `/Users/kk/Library/Application Support/com.clypra.editor` remains present.

If launch, project opening, import, timeline editing, or switching fails, move the failed app aside and restore the English backup exactly as documented in the parent localization plan.

- [ ] **Step 7: Record final evidence**

```bash
git status --short
git log --oneline --decorate -12
defaults read /Applications/Clypra.app/Contents/Info CFBundleShortVersionString
defaults read /Applications/Clypra.app/Contents/Info CFBundleIdentifier
lipo -archs /Applications/Clypra.app/Contents/MacOS/clypra
codesign --verify --deep --strict --verbose=2 /Applications/Clypra.app
```

Record test totals, backup path, selected persisted language, and whether rollback was needed. Do not push and do not create a PR.
