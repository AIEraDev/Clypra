# Clypra Thumbnail Generator — Architecture & Roadmap

**Date:** 2026-09-12  
**Status:** Shipped (Phase 1)  
**Location:** Desktop Editor (`clypra`), with optional future template distribution via `clypra-studio`.

---

## 1. Problem & Opportunity

A video's thumbnail is the single largest lever on click-through rate (CTR) before any viewer watches a frame. Previously, generating a thumbnail required creators to leave Clypra entirely (take a screenshot, open Photoshop/Canva, export, and manually manage files).

The **Clypra Thumbnail Generator** provides a complete, native authoring and export surface inside the desktop video editor. Creators can scrub their timeline, composite bold typography and graphic badges onto high-resolution frames, simulate real feed appearance, and export publication-ready PNG/JPEG images in under 30 seconds.

---

## 2. Core Architectural Invariants

1. **100% Offline & Private by Default**:
   - The user's video media never leaves their machine.
   - Frame rendering and compositing occur entirely on-device via Clypra's native render engine and Canvas 2D pipeline.
   - Zero telemetry leakage of raw video frames or graphic text content.
2. **Decoupled from Project Canvas Ratio**:
   - A 16:9 widescreen video project often requires a 9:16 vertical thumbnail for YouTube Shorts or TikTok covers, or a 1:1 square image for Instagram.
   - The thumbnail export pipeline uses cover-cropping to adapt any project aspect ratio to target platform dimensions.
3. **Decoupled from Internal Project Cover Thumbnail**:
   - `Project.thumbnail` remains the lightweight project-browser preview Data URL.
   - `Project.creatorThumbnails?: CreatorThumbnail[]` is an independent first-class array of user-designed, exportable thumbnail assets.
4. **Non-Blocking Background I/O**:
   - Native frame capture and disk file writing occur on background async threads without stalling the main UI or timeline playback.

---

## 3. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TOPBAR ENTRY POINT                            │
│           [Export Video (MP4/MOV)] ▾ [Create Thumbnail (NEW)]          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Opens (Lazy-loaded modal)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      THUMBNAIL WORKSPACE MODAL                          │
│ ┌───────────────────────────────────────┐ ┌───────────────────────────┐ │
│ │            VIEWPORT AREA              │ │     SIDEBAR INSPECTOR     │ │
│ │ • Aspect-ratio canvas (16:9, 9:16...) │ │ • Variants (A/B testing)  │ │
│ │ • Live compositing (Frame + Overlays) │ │ • Platform preset picker  │ │
│ │ • Compose vs Feed Preview tabs        │ │ • Typography & Badge edit │ │
│ │ • Timeline Frame Scrubber             │ │ • Position & Transform    │ │
│ └───────────────────┬───────────────────┘ └─────────────┬─────────────┘ │
│                     │                                   │               │
│                     └─────────────────┬─────────────────┘               │
│                                       ▼                                 │
│                           [Export PNG / JPEG (95%)]                     │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │ Tauri IPC
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NATIVE RUST ENGINE                              │
│  src-tauri/src/commands/creator_thumbnail.rs → export_creator_thumbnail │
│  • Pure native disk I/O with directory auto-creation                    │
│  • High-performance PNG & JPEG encoders (image crate)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Details

### A. Data Models (`src/types/index.ts`)

```ts
export type ThumbnailPlatformPresetKind =
  | "youtube"
  | "shorts"
  | "tiktok"
  | "instagram"
  | "custom";

export interface ThumbnailPlatformPreset {
  kind: ThumbnailPlatformPresetKind;
  label: string;
  width: number;
  height: number;
  aspectRatioLabel: string;
}

export interface ThumbnailOverlayLayer {
  id: string;
  kind: "text" | "badge";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  backgroundColor?: string;
  backgroundPadding?: number;
  borderRadius?: number;
  /** Normalized position 0.0 - 1.0 relative to canvas width */
  x: number;
  /** Normalized position 0.0 - 1.0 relative to canvas height */
  y: number;
  rotation?: number;
  opacity?: number;
  align?: "left" | "center" | "right";
}

export interface CreatorThumbnail {
  id: string;
  label: string;
  timestampMs: number;
  platformPreset: ThumbnailPlatformPreset;
  overlayLayers: ThumbnailOverlayLayer[];
  exportedDataUrl?: string;
  createdAt: number;
  updatedAt: number;
}
```

### B. Project Model & Serialization Persistence
- **TypeScript**: `creatorThumbnails?: CreatorThumbnail[]` added to `Project` (`src/types/index.ts`).
- **Rust Model**: Added `creator_thumbnails: Option<serde_json::Value>` with `#[serde(default)]` to `src-tauri/src/models/mod.rs` to ensure backward and forward compatibility.
- **Serialization**: `fromRustProject` and `toRustProject` map `creator_thumbnails` in `src/types/serialization.ts`.
- **Store Actions**: Added `addCreatorThumbnail`, `updateCreatorThumbnail`, and `removeCreatorThumbnail` to `src/store/projectStore.ts` with auto-save scheduling.

### C. Native Rust Export Engine (`src-tauri/src/commands/creator_thumbnail.rs`)
- Command: `export_creator_thumbnail(payload: ExportThumbnailPayload) -> Result<ExportThumbnailResult, String>`.
- Supports both base64 Data URLs (from HTML5 Canvas) and raw RGBA pixel buffers.
- Supports format conversion and quality control:
  - **PNG**: Lossless compression via `image::codecs::png::PngEncoder`.
  - **JPEG**: Adjustable quality ($1 \dots 100$, default 90) via `image::codecs::jpeg::JpegEncoder`.
- Automatically checks and creates destination directories via `fs::create_dir_all`.
- Invocation wrapper exposed in `src/lib/platform/tauri.ts` as `exportCreatorThumbnail`.

### D. Interactive Workspace UI (`src/features/creator-thumbnails/`)

| File | Purpose |
|---|---|
| `platformPresets.ts` | Data-driven platform presets: YouTube (1280×720, 16:9), Shorts (1080×1920, 9:16), TikTok (1080×1920, 9:16), Instagram (1080×1080, 1:1), Custom. |
| `thumbnailExport.ts` | Frame extraction via `buildNativeFrameRequest` + `renderNativeFrame`, 2D canvas compositing with cover-cropping, typography rendering, and save dialog integration. |
| `useThumbnailWorkspace.ts` | State management hook: manages active variant, debounced frame rendering, playhead syncing via `getPlaybackClock().time`, layer CRUD, and export progress. |
| `ThumbnailWorkspace.tsx` | Main dialog with dark glassmorphism styling, aspect ratio viewport, loading spinners, and Compose / Feed Preview tab switching. |
| `ThumbnailFrameScrubber.tsx` | Timeline scrubber slider with timecode display, frame stepping (`-1s`, `-0.1s`, `+0.1s`, `+1s`), and "Sync to Editor Playhead" button. |
| `ThumbnailPlatformPicker.tsx` | Platform and dimension preset selector cards. |
| `ThumbnailOverlayEditor.tsx` | Typography inspector: font family (Impact, Inter, Anton, Montserrat, Oswald), size, colors, stroke outline, drop shadows, badge backgrounds, and positioning. |
| `ThumbnailFeedPreview.tsx` | Real-world feed legibility simulation at **320px** (Desktop Feed), **168px** (Mobile/Sidebar Feed), and **120px** (Compact Suggestion) with mocked video title/views context. |
| `ThumbnailVariantList.tsx` | Multi-variant A/B card manager supporting creation, renaming, switching, and deleting variants. |

### E. TopBar Integration (`src/components/editor/TopBar.tsx`)
- Converted single "Export" button into a split dropdown menu:
  - Left button: Instant "Export Video".
  - Right chevron: Menu containing **Export Video** and **Create Thumbnail** (`NEW` badge).
  - Integrates `hideNativeSurfaceWhenIdle()` to prevent native video preview surface z-index clipping while the modal is open.

---

## 5. Verification Results

- **Unit Tests**: `src/features/creator-thumbnails/__tests__/thumbnailExport.test.ts` (9/9 tests passed in 6ms):
  - Standard platform presets and dimension verification.
  - Canvas compositing with multi-layer overlays.
  - ProjectStore variant lifecycle (`add`, `update`, `remove`).
- **TypeScript Typecheck**: `npm run typecheck` passed cleanly with 0 errors.
- **Rust Backend Compilation**: `cargo check --manifest-path src-tauri/Cargo.toml` compiled cleanly with 0 errors / 0 warnings.

---

## 6. Suggested Upgrades (Future Roadmap)

### Phase 2: Direct Canvas Interaction & Starter Presets
1. **Direct Viewport Manipulation (Drag & Resize Handles)**:
   - Allow creators to select, drag, scale, and rotate text/badge layers directly on the canvas viewport instead of adjusting sliders in the inspector.
2. **1-Click Starter Style Presets**:
   - Provide built-in thumbnail style packs (*Viral Tech Review*, *Dramatic Documentary*, *Gaming Reaction*, *Minimalist Vlog*) that apply font pairings, color palettes, and badge styles in one click.

### Phase 3: AI-Assisted Frame Detection & Smart Crop
3. **AI Smart "Best Frame" Detection**:
   - Activate Clypra's dormant ONNX MediaPipe commands (`run_face_tracking` in `commands/ai.rs`).
   - Sample candidate frames across the clip and automatically place star badges on the scrubber where the creator has an open, expressive face.
4. **Smart Face-Centered Auto-Crop for 9:16**:
   - Call `calculate_auto_reframe` to center on the subject's face when converting 16:9 footage to a 9:16 vertical thumbnail.
5. **Subject Cutout ("Text Behind Person")**:
   - Use Clypra's body segmentation model to composite text between the background frame and the isolated foreground person.

### Phase 4: Studio Cloud Catalog Sync
6. **Clypra Studio Template Authoring**:
   - Allow designers in `clypra-studio` (behind the admin lock-in) to author reusable thumbnail template definitions with placeholder slots (`MediaSlot`).
   - The desktop editor downloads template JSONs from the API and lets creators fill the `MediaSlot` locally with their project footage.
