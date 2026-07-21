# Clypra Simplified Chinese Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install a Simplified Chinese macOS edition of Clypra v1.1.1 while preserving the existing bundle identifier, user data, and a recoverable English application backup.

**Architecture:** Add a small typed localization layer whose domain catalogs contain paired English fallback and Simplified Chinese strings. Replace local user-visible literals with complete-sentence translation keys, keep remote/user/technical content unchanged, and enforce coverage with an AST-based source scan. Build the same Tauri application identifier and replace `/Applications/Clypra.app` only after the localized bundle passes tests and a launch smoke test.

**Tech Stack:** React 19, TypeScript 5.8, Vitest, Vite 7, Tauri 2, Rust, macOS arm64, FFmpeg.

---

## File structure

Create the localization core and one catalog per ownership boundary:

- `src/i18n/types.ts` — catalog and interpolation types.
- `src/i18n/index.ts` — `t()` and fallback/interpolation behavior.
- `src/i18n/index.test.ts` — localization unit tests.
- `src/i18n/catalogs/common.ts` — shared actions and generic statuses.
- `src/i18n/catalogs/shell.ts` — launch, recovery, recording, update, and application shell.
- `src/i18n/catalogs/settings.ts` — settings, cache, shortcuts, themes, and Whisper.
- `src/i18n/catalogs/editor.ts` — editor shell, media panel navigation, and preview controls.
- `src/i18n/catalogs/features.ts` — media libraries, captions, text/effect/filter/sticker/transition browsers.
- `src/i18n/catalogs/properties.ts` — properties panel, text styling, animation, transform, audio, and presets.
- `src/i18n/catalogs/timeline.ts` — timeline, tracks, clips, markers, gaps, history labels, and editing actions.
- `src/i18n/catalogs/system.ts` — export, permissions, service errors, and native-facing stable prefixes.
- `src/i18n/catalogs/index.ts` — merge domain catalogs into one typed message map.
- `scripts/check-ui-strings.mjs` — detect remaining local English JSX text, accessibility text, prompts, and label metadata.

The catalogs own complete messages. Components must not build sentences from translated fragments. Dynamic names, counts, durations, paths, and versions use `{{parameter}}` interpolation.

### Translation glossary

Use these terms consistently across all catalogs:

| English | Simplified Chinese |
|---|---|
| Timeline | 时间线 |
| Track | 轨道 |
| Clip | 片段 |
| Playhead | 播放头 |
| Transition | 转场 |
| Filter | 滤镜 |
| Effect | 效果 |
| Caption / Subtitle | 字幕 |
| Properties | 属性 |
| Transform | 变换 |
| Aspect Ratio | 画面比例 |
| Fade In / Fade Out | 淡入 / 淡出 |
| Export | 导出 |
| Render | 渲染 |
| Cache | 缓存 |
| Preset | 预设 |
| Marker | 标记 |
| Gap | 间隙 |
| Ripple Delete | 波纹删除 |
| Fit / Fill | 适应 / 填充 |

Keep these tokens unchanged: `Clypra`, `H.264`, `H.265`, `HEVC`, `ProRes`, `CRF`, `FPS`, `GPU`, `WebGL`, `PixiJS`, `FFmpeg`, `Whisper`, `WebM`, file extensions, font family names, paths, URLs, key symbols, and remote catalog content.

Before Task 1, run `npm ci`. Expected: `node_modules` is installed from `package-lock.json` without changing tracked dependency files.

## Task 1: Typed localization core

**Files:**
- Create: `src/i18n/types.ts`
- Create: `src/i18n/index.ts`
- Create: `src/i18n/index.test.ts`
- Create: `src/i18n/catalogs/common.ts`
- Create: `src/i18n/catalogs/shell.ts`
- Create: `src/i18n/catalogs/settings.ts`
- Create: `src/i18n/catalogs/editor.ts`
- Create: `src/i18n/catalogs/features.ts`
- Create: `src/i18n/catalogs/properties.ts`
- Create: `src/i18n/catalogs/timeline.ts`
- Create: `src/i18n/catalogs/system.ts`
- Create: `src/i18n/catalogs/index.ts`

- [ ] **Step 1: Write localization behavior tests**

Create `src/i18n/index.test.ts` with tests equivalent to:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveMessage, t } from "@/i18n";

describe("localization", () => {
  it("returns Simplified Chinese by default", () => {
    expect(t("common.cancel")).toBe("取消");
  });

  it("interpolates dynamic values into a complete sentence", () => {
    expect(t("common.selectedCount", { count: 3 })).toBe("已选择 3 项");
  });

  it("falls back to English when Chinese is empty", () => {
    expect(resolveMessage({ en: "Download", zhCN: "" }, "test.download")).toBe("Download");
  });

  it("keeps a missing parameter visible and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveMessage({ en: "Open {{name}}", zhCN: "打开 {{name}}" }, "test.open")).toBe("打开 {{name}}");
    expect(warn).toHaveBeenCalledWith('[i18n] Missing parameter "name" for "test.open"');
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `npm test -- --run src/i18n/index.test.ts`

Expected: FAIL because `@/i18n` does not exist.

- [ ] **Step 3: Implement catalog types and empty domain boundaries**

Create `src/i18n/types.ts`:

```ts
export interface LocalizedMessage {
  en: string;
  zhCN: string;
}

export type MessageParams = Record<string, string | number>;

export const defineMessages = <const T extends Record<string, LocalizedMessage>>(messages: T): T => messages;
```

Create the non-common domain files with these exact exports:

```ts
// src/i18n/catalogs/shell.ts
import { defineMessages } from "@/i18n/types";
export const shellMessages = defineMessages({});

// src/i18n/catalogs/settings.ts
import { defineMessages } from "@/i18n/types";
export const settingsMessages = defineMessages({});

// src/i18n/catalogs/editor.ts
import { defineMessages } from "@/i18n/types";
export const editorMessages = defineMessages({});

// src/i18n/catalogs/features.ts
import { defineMessages } from "@/i18n/types";
export const featureMessages = defineMessages({});

// src/i18n/catalogs/properties.ts
import { defineMessages } from "@/i18n/types";
export const propertyMessages = defineMessages({});

// src/i18n/catalogs/timeline.ts
import { defineMessages } from "@/i18n/types";
export const timelineMessages = defineMessages({});

// src/i18n/catalogs/system.ts
import { defineMessages } from "@/i18n/types";
export const systemMessages = defineMessages({});
```

Create `src/i18n/catalogs/common.ts`:

```ts
import { defineMessages } from "@/i18n/types";

export const commonMessages = defineMessages({
  "common.add": { en: "Add", zhCN: "添加" },
  "common.back": { en: "Back", zhCN: "返回" },
  "common.cancel": { en: "Cancel", zhCN: "取消" },
  "common.close": { en: "Close", zhCN: "关闭" },
  "common.confirm": { en: "Confirm", zhCN: "确认" },
  "common.delete": { en: "Delete", zhCN: "删除" },
  "common.dismiss": { en: "Dismiss", zhCN: "关闭提示" },
  "common.download": { en: "Download", zhCN: "下载" },
  "common.edit": { en: "Edit", zhCN: "编辑" },
  "common.error": { en: "Error", zhCN: "错误" },
  "common.import": { en: "Import", zhCN: "导入" },
  "common.loading": { en: "Loading...", zhCN: "正在加载…" },
  "common.none": { en: "None", zhCN: "无" },
  "common.remove": { en: "Remove", zhCN: "移除" },
  "common.reset": { en: "Reset", zhCN: "重置" },
  "common.retry": { en: "Try Again", zhCN: "重试" },
  "common.save": { en: "Save", zhCN: "保存" },
  "common.search": { en: "Search", zhCN: "搜索" },
  "common.settings": { en: "Settings", zhCN: "设置" },
  "common.success": { en: "Success", zhCN: "成功" },
  "common.selectedCount": { en: "{{count}} selected", zhCN: "已选择 {{count}} 项" },
});
```

- [ ] **Step 4: Merge catalogs and implement fallback/interpolation**

Create `src/i18n/catalogs/index.ts`:

```ts
import { commonMessages } from "@/i18n/catalogs/common";
import { editorMessages } from "@/i18n/catalogs/editor";
import { featureMessages } from "@/i18n/catalogs/features";
import { propertyMessages } from "@/i18n/catalogs/properties";
import { settingsMessages } from "@/i18n/catalogs/settings";
import { shellMessages } from "@/i18n/catalogs/shell";
import { systemMessages } from "@/i18n/catalogs/system";
import { timelineMessages } from "@/i18n/catalogs/timeline";

export const messages = {
  ...commonMessages,
  ...shellMessages,
  ...settingsMessages,
  ...editorMessages,
  ...featureMessages,
  ...propertyMessages,
  ...timelineMessages,
  ...systemMessages,
} as const;
```

Create `src/i18n/index.ts`:

```ts
import { messages } from "@/i18n/catalogs";
import type { LocalizedMessage, MessageParams } from "@/i18n/types";

export type MessageKey = keyof typeof messages;

const TOKEN = /\{\{([A-Za-z0-9_]+)\}\}/g;

export function resolveMessage(definition: Partial<LocalizedMessage> | undefined, key: string, params: MessageParams = {}): string {
  const template = definition?.zhCN?.trim() || definition?.en || key;
  return template.replace(TOKEN, (token, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) {
      if (import.meta.env.DEV) console.warn(`[i18n] Missing parameter "${name}" for "${key}"`);
      return token;
    }
    return String(value);
  });
}

export function t(key: MessageKey, params?: MessageParams): string {
  return resolveMessage(messages[key], key, params);
}
```

- [ ] **Step 5: Run focused tests and type checking**

Run: `npm test -- --run src/i18n/index.test.ts && npx tsc --noEmit`

Expected: localization tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/i18n
git commit -m "feat: add typed Simplified Chinese localization core"
```

## Task 2: Launch, recovery, recording, update, and application shell

**Files:**
- Modify: `src/i18n/catalogs/shell.ts`
- Modify: `src/i18n/catalogs/system.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/ErrorBoundary.tsx`
- Modify: `src/components/screens/LaunchScreen.tsx`
- Modify: `src/store/projectStore.ts`
- Modify: `src/components/ui/CrashRecoveryDialog.tsx`
- Modify: `src/components/ui/ClosingProjectModal.tsx`
- Modify: `src/components/ui/FloatingWidget.tsx`
- Modify: `src/components/ui/ScreenRecordingPreviewModal.tsx`
- Modify: `src/components/ui/UpdateBanner.tsx`
- Modify: `src/components/ui/DownloadProgress.tsx`
- Modify: `src/components/ui/SuccessToast.tsx`
- Modify: `src/components/ui/NetworkError.tsx`
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/components/ui/BottomSheet.tsx`
- Modify: `src/services/dualRecordService.ts`
- Modify: `src/hooks/useAutoUpdater.ts`
- Modify: `src/services/updaterService.ts`
- Modify: `index.html`
- Test: `src/i18n/catalogs/shell.test.ts`

- [ ] **Step 1: Add failing catalog assertions for dates and dynamic shell messages**

Test exact outputs for `Today → 今天`, `Yesterday → 昨天`, `{{count}} days ago → {{count}} 天前`, recovery project interpolation, recording permission guidance, update version/progress, and error-prefix wrapping. Also assert that a device name and Release Notes body passed as parameters remain unchanged.

- [ ] **Step 2: Add complete shell and stable system messages**

Add keys for every local literal in the listed files. Use full messages such as:

```ts
"launch.createProject": { en: "Create Project", zhCN: "新建项目" },
"launch.recentProjects": { en: "Recent Projects", zhCN: "最近项目" },
"launch.untitledProject": { en: "Untitled Project", zhCN: "未命名项目" },
"launch.daysAgo": { en: "{{count}} days ago", zhCN: "{{count}} 天前" },
"recovery.restoreProject": { en: "Restore {{project}}", zhCN: "恢复“{{project}}”" },
"recording.permissionDenied": {
  en: "Could not access camera or microphone. Check macOS System Settings → Privacy & Security.",
  zhCN: "无法访问摄像头或麦克风。请检查 macOS“系统设置”→“隐私与安全性”。",
},
"update.available": { en: "Clypra {{version}} is available", zhCN: "Clypra {{version}} 可用" },
"update.downloading": { en: "Downloading update: {{percent}}%", zhCN: "正在下载更新：{{percent}}%" },
```

Use `Intl.DateTimeFormat("zh-CN", ...)` for visible dates. Do not translate project names, device names, versions, paths, or server-provided Release Notes.

- [ ] **Step 3: Replace shell literals with `t()` calls**

Import `t` from `@/i18n`. Replace JSX text, `title`, `aria-label`, `placeholder`, toast text, confirm text, and local error strings. Convert default visible names such as `Screen Recording Project` and the system save-filter display name `Video`; keep MIME types and file extensions unchanged.

- [ ] **Step 4: Run focused shell tests**

Run: `npm test -- --run src/i18n/catalogs/shell.test.ts src/services/__tests__/updaterService.test.ts src/services/__tests__/dualRecordService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html src/App.tsx src/components/ErrorBoundary.tsx src/components/screens/LaunchScreen.tsx src/store/projectStore.ts src/components/ui src/services/dualRecordService.ts src/hooks/useAutoUpdater.ts src/services/updaterService.ts src/i18n/catalogs/shell.ts src/i18n/catalogs/system.ts src/i18n/catalogs/shell.test.ts
git commit -m "feat: localize application shell and recording flows"
```

## Task 3: Settings, shortcuts, cache, Whisper, and export

**Files:**
- Modify: `src/i18n/catalogs/settings.ts`
- Modify: `src/i18n/catalogs/system.ts`
- Modify: `src/components/ui/SettingsModal.tsx`
- Modify: `src/components/settings/CacheSettings.tsx`
- Modify: `src/components/settings/KeyboardShortcutsSettings.tsx`
- Modify: `src/components/settings/WhisperSettings.tsx`
- Modify: `src/store/settingsStore.ts`
- Modify: `src/store/shortcutStore.ts`
- Modify: `src/hooks/useCacheManager.ts`
- Modify: `src/lib/cache/cacheManager.ts`
- Modify: `src/components/ui/ExportDialog.tsx`
- Modify: `src/components/ui/ExportPresetCard.tsx`
- Modify: `src/components/ui/ProgressRing.tsx`
- Modify: `src/lib/export/exportPresets.ts`
- Modify: `src/lib/export/mobileExport.ts`
- Modify: `src/lib/export/cloudExport.ts`
- Modify: `src/lib/export/videoExport.ts`
- Modify: `src-tauri/Info.plist`
- Modify: `src-tauri/src/commands/whisper.rs`
- Modify: `src-tauri/src/commands/export.rs`
- Test: `src/i18n/catalogs/settings.test.ts`
- Test: `src/i18n/catalogs/system.test.ts`

- [ ] **Step 1: Write failing settings/export catalog tests**

Cover every settings tab label; Chinese search for shortcut action/category labels; 99 Whisper language display names while retaining language codes; cache size/error interpolation; export phases and five preset display names; technical values `H.264`, `H.265`, `ProRes`, `CRF`, resolution, FPS, and paths unchanged.

- [ ] **Step 2: Populate settings messages and translated display metadata**

Add keys for theme editor labels, editor defaults, About, manual updates, cache categories, shortcut categories/actions/conflicts, Whisper model descriptions/statuses/languages, and privacy text. Preserve persisted IDs and settings values. In `SettingsModal.tsx`, import `packageJson` from `../../../package.json` and render `packageJson.version` instead of the hard-coded About version `1.0.1`, so this build shows `1.1.1`.

For category-style data, keep stable IDs and translate only display fields:

```ts
{ id: "editing", label: t("settings.shortcuts.category.editing") }
```

- [ ] **Step 3: Populate export/system messages and localize permission prompts**

Translate configuration, exporting, completion, and error stages, preset names/descriptions, estimated size/time, rename controls, and stable failure prefixes. Keep encoder names and raw FFmpeg/system details unchanged. In `src-tauri/Info.plist`, translate the three macOS camera/microphone/screen-related usage descriptions into concise Simplified Chinese. In `whisper.rs` and `export.rs`, translate only stable application-authored error prefixes and retain paths, model names, timestamps, and FFmpeg stderr verbatim.

- [ ] **Step 4: Run settings and export tests**

Run: `npm test -- --run src/i18n/catalogs/settings.test.ts src/i18n/catalogs/system.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/catalogs/settings.ts src/i18n/catalogs/system.ts src/components/ui/SettingsModal.tsx src/components/settings src/store/settingsStore.ts src/store/shortcutStore.ts src/hooks/useCacheManager.ts src/lib/cache/cacheManager.ts src/components/ui/ExportDialog.tsx src/components/ui/ExportPresetCard.tsx src/components/ui/ProgressRing.tsx src/lib/export src-tauri/Info.plist src-tauri/src/commands/whisper.rs src-tauri/src/commands/export.rs src/i18n/catalogs/settings.test.ts src/i18n/catalogs/system.test.ts
git commit -m "feat: localize settings and export workflows"
```

## Task 4: Editor shell, navigation, media panel, and preview

**Files:**
- Modify: `src/i18n/catalogs/editor.ts`
- Modify: `src/components/editor/TopBar.tsx`
- Modify: `src/components/editor/EditorLayout.tsx`
- Modify: `src/components/editor/MobileEditorLayout.tsx`
- Modify: `src/components/editor/PropertiesPanel.tsx`
- Modify: `src/components/editor/media-panel/EnhancedMediaPanel.tsx`
- Modify: `src/components/editor/media-panel/AudioWaveform.tsx`
- Modify: `src/components/editor/preview/SourcePreview.tsx`
- Modify: `src/components/editor/preview/PixiProgramPreview.tsx`
- Modify: `src/components/editor/preview/PreviewTransport.tsx`
- Modify: `src/components/editor/preview/PlaybackSpeedSelector.tsx`
- Modify: `src/components/editor/preview/PlaybackQualitySelector.tsx`
- Modify: `src/components/editor/preview/AspectSelector.tsx`
- Modify: `src/components/editor/preview/VolumeControl.tsx`
- Modify: `src/components/editor/preview/GPUPreview.tsx`
- Modify: `src/components/editor/preview/WebGLUnavailableError.tsx`
- Modify: `src/components/editor/preview/TelemetryOverlay.tsx`
- Modify: `src/components/editor/viewport/SafeOverlay.tsx`
- Modify: `src/components/ui/AspectRatio.tsx`
- Modify: `src/types/index.ts`
- Test: `src/i18n/catalogs/editor.test.ts`
- Test: affected files under `src/components/editor/preview/__tests__/`

- [ ] **Step 1: Write failing editor catalog tests**

Assert translated navigation tabs, mobile bottom actions, bottom-sheet titles, preview controls, source In/Out messages, quality descriptions, aspect labels, safe-zone labels, GPU/WebGL failures, and dynamic dimensions/duration messages.

- [ ] **Step 2: Populate editor messages and replace literals**

Translate all local visible strings and accessibility attributes in the listed files. Keep `WebGL`, `PixiJS`, `GPU`, `Rec.709`, aspect numbers, dimensions, FPS values, timecodes, and source filenames unchanged. Use complete keys for messages such as `Add {{duration}}s to Timeline → 将 {{duration}} 秒添加到时间线`.

- [ ] **Step 3: Update preview assertions**

Change tests that assert English labels to the Chinese catalog result or stable roles. Add assertions for `aria-label` and tooltip text so accessibility strings are included in coverage.

- [ ] **Step 4: Run editor/preview tests**

Run: `npm test -- --run src/i18n/catalogs/editor.test.ts src/components/editor/preview/__tests__`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/catalogs/editor.ts src/components/editor src/components/ui/AspectRatio.tsx src/types/index.ts
git commit -m "feat: localize editor navigation and previews"
```

## Task 5: Media libraries, captions, text, filters, effects, stickers, and transitions

**Files:**
- Modify: `src/i18n/catalogs/features.ts`
- Modify: `src/components/editor/media-tabs/MediaTab.tsx`
- Modify: `src/components/editor/media-tabs/AudioTab.tsx`
- Modify: `src/components/editor/media-tabs/TextTab.tsx`
- Modify: `src/components/editor/media-tabs/CaptionsTab.tsx`
- Modify: `src/components/editor/media-tabs/StickersTab.tsx`
- Modify: `src/components/editor/media-tabs/FiltersTab.tsx`
- Modify: `src/components/editor/media-tabs/TransitionsTab.tsx`
- Modify: `src/components/ui/MediaCard.tsx`
- Modify: `src/components/ui/TemplateCard.tsx`
- Modify: `src/components/ui/EffectCard.tsx`
- Modify: `src/features/video-effects/components/EffectsPanel.tsx`
- Modify: `src/features/video-effects/components/EffectPicker.tsx`
- Modify: `src/features/video-effects/components/RendererEffectsBrowser.tsx`
- Modify: `src/features/text-effects/components/EffectGrid.tsx`
- Modify: `src/features/text-effects/components/EffectPreview.tsx`
- Modify: `src/features/audio-library/api/audioLibraryApi.ts`
- Modify: `src/features/stickers/api/stickersApi.ts`
- Modify: `src/features/text-effects/api/textEffectsApi.ts`
- Modify: `src/features/text-templates/types.ts`
- Test: `src/i18n/catalogs/features.test.ts`
- Test: `src/components/ui/__tests__/EffectCard.test.tsx`
- Test: `src/components/ui/__tests__/TemplateCard.test.tsx`
- Test: `src/features/text-effects/components/__tests__/EffectGrid.test.tsx`

- [ ] **Step 1: Write failing feature catalog tests**

Assert translated local category labels while IDs remain unchanged; loading/network/empty/download/cache/apply/favorite messages; caption import/export/model/generation/timing messages; dynamic counts and names; and English remote item names passed through untouched.

- [ ] **Step 2: Translate local category display maps without changing IDs**

Keep identifiers such as `lo-fi`, `hip-hop`, `lower-third`, `title-card`, `3d`, and sticker/filter/transition IDs. Add translated display-label maps and use them only when rendering local category names.

- [ ] **Step 3: Replace all local feature literals**

Translate tab content, buttons, empty states, tooltips, placeholders, alerts, and errors. Translate generated local defaults `Auto Captions`, `New Caption Text`, and `Library Audio`. Replace TextTab's English demonstration caption sentences with natural Chinese demonstration sentences because they are locally generated user-visible content. Preserve server item names, authors, descriptions, tags, URLs, and downloaded filenames.

- [ ] **Step 4: Update affected component tests**

Update assertions for `Downloading...`, add-effect labels, template states, and translated category display labels. Keep selectors based on stable roles or category IDs where possible.

- [ ] **Step 5: Run feature tests**

Run: `npm test -- --run src/i18n/catalogs/features.test.ts src/components/ui/__tests__/EffectCard.test.tsx src/components/ui/__tests__/TemplateCard.test.tsx src/features/text-effects/components/__tests__/EffectGrid.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/catalogs/features.ts src/components/editor/media-tabs src/components/ui/MediaCard.tsx src/components/ui/TemplateCard.tsx src/components/ui/EffectCard.tsx src/features
git commit -m "feat: localize media and creative feature panels"
```

## Task 6: Properties, text styling, animation, and presets

**Files:**
- Modify: `src/i18n/catalogs/properties.ts`
- Modify: `src/components/editor/properties/EmptyPropertiesState.tsx`
- Modify: `src/components/editor/properties/AudioSection.tsx`
- Modify: `src/components/editor/properties/TransitionSection.tsx`
- Modify: `src/components/editor/properties/TextAnimationControls.tsx`
- Modify: `src/components/editor/properties/TransformSection.tsx`
- Modify: `src/components/editor/properties/EffectsFiltersSection.tsx`
- Modify: `src/components/editor/properties/TimelineEffectSection.tsx`
- Modify: `src/components/editor/properties/StickerSettingsSection.tsx`
- Modify: `src/components/editor/properties/TextStyleSection.tsx`
- Modify: `src/components/editor/properties/TextModeSelector.tsx`
- Modify: `src/components/editor/properties/EffectStylePanel.tsx`
- Modify: `src/components/editor/properties/TemplateLayerEditor.tsx`
- Modify: `src/lib/text/textAnimation.ts`
- Modify: `src/store/presetStore.ts`
- Test: `src/i18n/catalogs/properties.test.ts`
- Test: files under `src/components/editor/properties/__tests__/`

- [ ] **Step 1: Write failing properties catalog tests**

Cover clip-type labels, property tabs, transform controls, audio/fades, transition settings, text modes, typography, colors/effects, preset/template labels, animation names, switches, and dynamic values. Assert that font names, `px`, `%`, seconds, degrees, and URLs remain unchanged.

- [ ] **Step 2: Populate properties messages and display metadata**

Translate all local property labels and descriptions. Keep stored preset IDs and behavior unchanged while translating display names such as `Neon Glow → 霓虹光效`, `Minimalist Sans → 极简无衬线`, `Classic Editorial → 经典编辑风`, and `Premium Subtitle → 高级字幕`.

- [ ] **Step 3: Replace component literals and update tests**

Use `t()` for all JSX, headings, buttons, `PropertySection` titles, placeholders, tooltip text, and local confirmations. Replace English-regex test assertions such as `/fade/i` with catalog output or stable roles.

- [ ] **Step 4: Run properties tests**

Run: `npm test -- --run src/i18n/catalogs/properties.test.ts src/components/editor/properties/__tests__`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/catalogs/properties.ts src/components/editor/properties src/lib/text/textAnimation.ts src/store/presetStore.ts
git commit -m "feat: localize clip properties and text styling"
```

## Task 7: Timeline, tracks, clips, markers, and history labels

**Files:**
- Modify: `src/i18n/catalogs/timeline.ts`
- Modify: files under `src/components/editor/timeline/`
- Modify: `src/store/timelineStore.ts`
- Modify: `src/lib/timeline/timelineZoom.ts`
- Modify: `src/lib/timeline/timelineUtils.ts`
- Modify: `src/hooks/useSplitMode.ts`
- Modify: `src/core/interactions/EditingActions.ts`
- Modify: files under `src/core/history/commands/`
- Test: `src/i18n/catalogs/timeline.test.ts`
- Test: `src/components/editor/timeline/__tests__/TimelineToolbar.test.tsx`
- Test: `src/components/editor/timeline/__tests__/Clip.test.tsx`

- [ ] **Step 1: Write failing timeline catalog tests**

Cover toolbar actions, zoom accessibility text, empty/drop/new-track states, track controls, clip fallback labels, trim hints, markers, gaps, waveform state, transition tooltip, generated `Video/Audio/Text {{number}}` labels, and complete `Undo {{action}}` / `Redo {{action}}` messages.

- [ ] **Step 2: Populate timeline messages and translate history command labels**

Use noun phrases for history actions so interpolation remains natural in Chinese, for example `删除片段`, `插入间隙`, `调整间隙`, and `删除轨道`. Translate visible generated names but preserve track/clip IDs and serialization values.

- [ ] **Step 3: Replace timeline literals and update assertions**

Translate JSX text, context menus, tooltips, `aria-label`, marker UI, toasts, and visible errors. Update tests that currently expect `Zoom in timeline` and fallback `Clip`.

- [ ] **Step 4: Run timeline tests**

Run: `npm test -- --run src/i18n/catalogs/timeline.test.ts src/components/editor/timeline/__tests__`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/catalogs/timeline.ts src/components/editor/timeline src/store/timelineStore.ts src/lib/timeline src/hooks/useSplitMode.ts src/core/interactions/EditingActions.ts src/core/history/commands
git commit -m "feat: localize timeline and editing history"
```

## Task 8: Enforce translation coverage and run the complete test suite

**Files:**
- Create: `scripts/check-ui-strings.mjs`
- Modify: `package.json`
- Modify: any production file reported by the scan
- Modify: any test whose expected visible text changed

- [ ] **Step 1: Add an AST-based English-literal scanner**

Use the installed `typescript` package to parse production `.ts` and `.tsx` files. Report:

- JSX text containing ASCII words.
- String literals assigned to `title`, `placeholder`, `aria-label`, `alt`, `label`, `description`, `tooltip`, or user-facing `message` properties.
- String literals passed to `alert`, `confirm`, user-facing toast helpers, or `setError` in components/hooks/services.

Exclude test/debug files and allow exact technical/brand tokens listed in this plan. The script must print `file:line: text` for each violation and exit 1 when violations exist.

- [ ] **Step 2: Register the check**

Add to `package.json`:

```json
"check:i18n": "node scripts/check-ui-strings.mjs"
```

- [ ] **Step 3: Run the scan and fix every local violation**

Run: `npm run check:i18n`

Expected: `i18n check passed: no untranslated local UI strings` and exit 0. Add an allowlist entry only for a stable technical token, brand, font name, key symbol, remote field, URL, MIME type, or file extension; do not allow a complete English UI sentence.

- [ ] **Step 4: Run frontend verification**

Run:

```bash
npm run check:i18n
npx tsc --noEmit
npm test -- --run
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-ui-strings.mjs package.json src
git commit -m "test: enforce Simplified Chinese UI coverage"
```

## Task 9: Rust verification and localized macOS build

**Files:**
- Do not commit generated files under `node_modules`, `dist`, or `src-tauri/target`.

- [ ] **Step 1: Install build dependencies**

Run `brew install pkgconf`, then run `pkg-config --version`.

Expected: Homebrew installs `pkgconf` and `pkg-config --version` prints a version.

- [ ] **Step 2: Verify Rust code**

Run:

```bash
PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/lib/pkgconfig cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/lib/pkgconfig cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: tests pass, formatting is clean, and Clippy reports no warnings.

- [ ] **Step 3: Build an unsigned local application bundle**

Run:

```bash
PKG_CONFIG_PATH=/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/lib/pkgconfig npm run tauri -- build --target aarch64-apple-darwin --bundles app --no-sign --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Expected bundle: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app`.

- [ ] **Step 4: Ad-hoc sign and verify the build**

Run:

```bash
codesign --force --deep --sign - src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app
codesign --verify --deep --strict --verbose=2 src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app
```

Expected: strict signature verification exits 0.

- [ ] **Step 5: Smoke-test the built bundle before installation**

Run:

```bash
open -n --env PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app
```

Verify the process starts, the launch screen is Chinese, project creation works, and an imported media file reaches the editor. The bundled FFmpeg/FFprobe files are upstream PATH-dependent wrapper scripts, so this build remains functionally equivalent to the official v1.1.1 package on this Mac.

## Task 10: Back up English Clypra and install the localized build

**Targets:**
- Existing app: `/Applications/Clypra.app`
- Backup: `/Applications/Clypra-English-1.1.1.app.backup`
- Localized build: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app`
- User data: `/Users/kk/Library/Application Support/com.clypra.editor`

- [ ] **Step 1: Validate exact targets and identity**

Run:

```bash
test -d /Applications/Clypra.app
test ! -e /Applications/Clypra-English-1.1.1.app.backup
defaults read /Applications/Clypra.app/Contents/Info CFBundleShortVersionString
defaults read /Applications/Clypra.app/Contents/Info CFBundleIdentifier
defaults read src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app/Contents/Info CFBundleIdentifier
```

Expected: original version `1.1.1`; both identifiers `com.clypra.editor`.

- [ ] **Step 2: Stop Clypra and create a recoverable backup**

Quit the application normally, then confirm no process remains. Move only the validated application path:

```bash
mv /Applications/Clypra.app /Applications/Clypra-English-1.1.1.app.backup
```

- [ ] **Step 3: Install the localized bundle**

Run:

```bash
ditto src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Clypra.app /Applications/Clypra.app
codesign --verify --deep --strict --verbose=2 /Applications/Clypra.app
```

Expected: copy and signature verification succeed.

- [ ] **Step 4: Launch and perform final smoke tests**

Run:

```bash
open -n --env PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /Applications/Clypra.app
```

Verify launch, create/open project, media import, timeline controls, properties, captions, settings, export dialog, and all principal tabs. Confirm `/Users/kk/Library/Application Support/com.clypra.editor` remains present and existing projects open.

- [ ] **Step 5: Roll back if launch or core workflow verification fails**

Move the failed localized app aside without deleting it, then restore the English backup:

```bash
mv /Applications/Clypra.app /Applications/Clypra-Chinese-Failed-1.1.1.app.backup
mv /Applications/Clypra-English-1.1.1.app.backup /Applications/Clypra.app
```

Launch the restored application and confirm the original process starts.

- [ ] **Step 6: Record final verification**

Run `git status --short`, `git log --oneline --decorate -10`, and record the localized app version, bundle identifier, architecture, signature result, test summary, backup path, and whether rollback was needed.
