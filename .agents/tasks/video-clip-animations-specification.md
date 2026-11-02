# Video Clip Animations System - Complete Specification

**Status:** Approved for Implementation  
**Date:** January 2025  
**Version:** 1.0  

## Executive Summary

This specification defines a complete Effects Studio ecosystem for creating, distributing, and applying video clip animations in Clypra. Effects are **clip-attached rendering operations** (not independent timeline clips), with versioned immutable definitions managed through a Studio → API → Editor workflow.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Clypra Effects Studio (clypra-studio)                       │
│  • Composition Editor                                        │
│  • Asset Management & Import                                 │
│  • Internal Animation Timeline                               │
│  • Validation Engine                                         │
│  • Publishing Pipeline                                       │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│  Effects API (clypra-api)                                    │
│  • Draft Lifecycle (/studio/effects)                         │
│  • Asset Upload (presigned R2 URLs)                          │
│  • Processing Worker (FFmpeg validation)                     │
│  • Publishing (versioned immutable releases)                 │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare R2 + CDN                                         │
│  /effects/:id/:version/                                      │
│    • manifest.json                                           │
│    • assets/ (ProRes 4444 MOV)                               │
│    • preview/ (MP4)                                          │
│    • thumbnails/ (WebP)                                      │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│  Clypra Editor                                               │
│  • Effect Registry (catalog fetch)                           │
│  • Asset Manager (content-addressed cache)                   │
│  • Effect Runtime (independent decoder contexts)             │
│  • wgpu Compositor (extend existing)                         │
└──────────────────────────────────────────────────────────────┘
```

## Critical Architectural Principles

### 1. Effects are Clip-Attached Rendering Operations

Effects are **NOT** independent timeline clips. They attach to existing clips and modify their rendering output. The Parting Leaves animation asset is an internal rendering dependency, not a timeline object.

### 2. Separation of Concerns

```
Effect Definition (immutable)
    ↓
Effect Assets (content-addressed)
    ↓
Effect Instance (per-clip application)
```

### 3. Independent Decoder Contexts

```
EffectAssetManager
    ├── Shared Asset Metadata (immutable)
    ├── Decoder Context A → Playback State A
    ├── Decoder Context B → Playback State B
    └── Shared Decoded Frame Cache (bounded, LRU)
```

**DO NOT share mutable decoder state between instances.**

### 4. Versioned Immutability

- Projects pin exact effect versions
- Published effects are immutable
- Assets are content-addressed (SHA-256)
- Reproducibility guaranteed

### 5. Preview/Export Parity

Preview and export must produce **visually equivalent output within defined tolerance** (SSIM or pixel diff threshold). Implementation backends may differ as long as semantics are shared.

## Data Model

### Effect Instance (Attached to Clip)

```typescript
interface ClipEffectInstance {
  instanceId: string;
  
  effectRef: {
    effectId: string;
    version: string;  // Pin exact version
  };
  
  enabled: boolean;
  
  // Instance overrides (optional)
  // Precedence: instance > manifest
  startFrame?: number;
  durationFrames?: number;
  
  parameters: Record<string, unknown>;
  order: number;  // Execution order
}
```

### Effect Manifest (Published Definition)

```typescript
interface EffectManifest {
  schemaVersion: number;
  id: string;
  version: string;
  
  name: string;
  description: string;
  
  // Separate phase from category
  phase: "in" | "out" | "combo";
  category: string;  // "nature", "light", "glitch"
  tags: string[];    // ["trending", "foliage"]
  
  renderer: EffectRenderer;
  
  canvas: {
    width: number;
    height: number;
    coordinateSpace: "clip" | "canvas";
  };
  
  timing: {
    anchor: "clip_start" | "clip_end";
    offsetFrames: number;
    durationFrames: number;
    fpsNum: number;  // Effect asset FPS
    fpsDen: number;  // Rational timebase
    playback: "once" | "loop" | "pingpong";
  };
  
  assets: EffectAsset[];
  layers: EffectLayer[];
  
  thumbnailUrl: string;
  previewVideoUrl?: string;
}
```

### Renderer Types

```typescript
// Start with 2, expand later
type EffectRenderer =
  | { kind: "transform"; tracks: KeyframeTrack[] }
  | { kind: "media_composite" };

// Post-MVP:
// | { kind: "alpha_matte" }
// | { kind: "shader"; shaderId: string }
```

### Asset and Layer Separation

```typescript
// Asset describes pixel interpretation
interface EffectAsset {
  id: string;
  role: "foreground_animation" | "alpha_mask" | "texture";
  path: string;  // Relative to effect package
  format: string;
  codec: string;
  alphaMode: "straight" | "premultiplied" | "none";
  width: number;
  height: number;
  fpsNum: number;
  fpsDen: number;
  sha256: string;
}

// Layer describes compositing behavior
interface EffectLayer {
  id: string;
  assetId: string;  // References assets array
  blendMode: BlendMode;
  opacity: number;
  visible: boolean;
}
```

### Separated State Machines

```typescript
// Asset processing lifecycle
type AssetProcessingState =
  | "uploaded"
  | "processing"
  | "validating"
  | "ready"
  | "failed";

// Effect release lifecycle
type EffectReleaseState =
  | "draft"
  | "validating"
  | "ready_to_publish"
  | "published"
  | "failed";

interface AssetRecord {
  id: string;
  effectId: string;
  filename: string;
  size: number;
  sha256?: string;
  state: AssetProcessingState;
  uploadedAt: number;
  processedAt?: number;
  failureReason?: string;
  retryCount: number;
}

interface EffectRelease {
  id: string;
  effectId: string;
  version: string;
  state: EffectReleaseState;
  manifestUrl?: string;
  publishedAt?: number;
}
```

## Timing Resolution Rules

1. **Manifest defines default timing**
2. **Instance can override timing** (optional `startFrame`, `durationFrames`)
3. **Instance overrides take precedence**
4. **Both use project timeline frame coordinates**
5. **Effect asset FPS independent of project FPS**
6. **Use integer frames with explicit rational timebases** (not floating-point)

## Asset Processing Requirements

### Alpha Channel Validation

**DO NOT rely solely on FFprobe metadata.**

Validation worker must:
1. Inspect codec and pixel format
2. Decode representative frames (first, middle, last, random)
3. **Inspect actual alpha plane values**
4. Check alpha distribution (verify meaningful transparency)
5. Composite over checkerboard pattern
6. Verify output matches expected transparency

### Idempotent Processing

- Worker processing must be idempotent
- Retried jobs must not create duplicate packages
- State transitions must be safe for concurrent execution

### Asset Processing Pipeline

```
Asset Upload → R2
    ↓
State: uploaded
    ↓
Worker: FFprobe inspection
Worker: Decode & validate alpha
Worker: Calculate SHA-256
    ↓
State: processing → validating
    ↓
Worker: Generate thumbnail (WebP)
Worker: Generate preview (MP4 over sample footage)
Worker: Create runtime package
    ↓
State: ready
    ↓
(on publish)
    ↓
State: published (immutable)
```

## API Endpoints

```
# Studio Publishing
POST   /studio/effects                              # Create draft
PATCH  /studio/effects/:id                          # Update metadata
POST   /studio/effects/:id/assets                   # Request presigned URL
POST   /studio/effects/:id/assets/:assetId/complete # Confirm upload
POST   /studio/effects/:id/validate                 # Run validation
POST   /studio/effects/:id/publish                  # Publish version

# Editor Consumption
GET    /video-animations                            # Lightweight catalog
GET    /video-animations/:category                  # Filter by category
GET    /video-animations/:id/versions/:version      # Get manifest
```

## Implementation Phases

### Phase 0: Architecture Audit (MANDATORY FIRST)

**Deliverables Required:**
1. Architecture map: Timeline clip → preview frame rendering flow
2. Integration map: Exact functions/structs/interfaces requiring extension
3. Decoder analysis: FFmpeg capabilities, alpha handling, seeking
4. Preview/export analysis: Path differences, shared semantics, visual tolerance
5. Implementation proposal: Files to modify, interfaces, risks, tests

**DO NOT proceed to Phase 1 without approved Phase 0 artifacts.**

### Phase 1: Local Rendering Proof of Concept

Implement Parting Leaves using locally available asset. No API, no Studio, no cloud storage.

**Prove:**
- RGBA ProRes 4444 decoding with alpha
- Correct alpha compositing in wgpu
- Playback and scrubbing
- Independent decoder contexts with shared cache
- Export rendering with visual equivalence

**Milestone Gate:** Local rendering must work before Phase 2.

### Phase 2: Effect Contracts & Publishing Infrastructure

- Effect manifest schema (TypeScript + Rust)
- Separated state machines (asset vs release)
- Draft lifecycle API
- Asset upload orchestration (presigned R2 URLs)
- Comprehensive FFmpeg validator (actual alpha inspection)
- Runtime package generator

### Phase 3: Studio MVP

- Minimal authoring experience
- Asset import and management
- Composition preview
- Timing controls
- Validation and publishing UI

**DO NOT build sophisticated node editor or advanced timeline yet.**

### Phase 4: Editor Integration

- Effect Registry (catalog fetch)
- Effect Browser UI
- Content-addressed Asset Manager
- Manifest fetching and resolution
- Clip effect instances
- Effect rendering in preview

### Phase 5: Export Integration

- Export with effects
- Visual regression testing
- Asset availability checks

### Phase 6: Performance Benchmarking

**Test Environment:**
- Project: 1920×1080, 30fps
- Effect: 1920×1080 ProRes 4444
- Hardware: Document minimum GPU
- Test cases: 1, 2, 3 simultaneous effects

**Measurements:**
- Decode time (p50, p95)
- GPU upload time
- Composite render time
- Total frame time

**Target:** p95 < 33ms at 30fps

### Phase 7: Advanced Features (Post-MVP)

- Alpha matte renderer
- Shader renderer (controlled, no untrusted shaders initially)
- Multi-layer composition
- Parameter customization UI

## Success Criteria

### MVP Release

1. ✅ Parting Leaves works end-to-end (Studio → API → Editor → Export)
2. ✅ Transform animations integrate with existing system
3. ✅ Effects versioned and immutable, projects pin exact versions
4. ✅ Preview and export visually equivalent (defined tolerance)
5. ✅ Performance: p95 < 33ms at 30fps (documented environment)
6. ✅ Independent decoder contexts, shared cache efficient
7. ✅ Asset cache content-addressed, no redundant downloads

## Critical Implementation Rules

### DO NOT:
1. ❌ Modify compositor before Phase 0 identifies correct integration point
2. ❌ Share mutable decoder state between effect instances
3. ❌ Implement all 4 renderer types simultaneously (start with 2)
4. ❌ Commit to ProRes 4444 as final runtime format (benchmark-driven)
5. ❌ Proceed past Phase 0 without approved deliverables
6. ❌ Duplicate rendering infrastructure (extend existing)
7. ❌ Rely on FFprobe metadata alone for alpha validation
8. ❌ Mix asset processing state with effect release state

### DO:
1. ✅ Audit existing architecture first
2. ✅ Prove rendering locally before building infrastructure
3. ✅ Use independent decoder contexts per instance
4. ✅ Implement comprehensive alpha validation (decode and inspect)
5. ✅ Make worker processing idempotent
6. ✅ Separate timing precedence (instance > manifest)
7. ✅ Use integer frames with rational timebases
8. ✅ Define visual equivalence tolerance for preview/export parity
9. ✅ Benchmark performance with specific test environment

## Format Decisions

### Initial Implementation

- **Authoring:** ProRes 4444 MOV (straight alpha)
- **Runtime:** ProRes 4444 MOV initially
- **Optimization:** Benchmark-driven after MVP

### Post-MVP Evaluation

Benchmark ProRes 4444 vs alternatives:
- PNG sequence
- VP9 with alpha
- Other alpha-capable codecs

Criteria: decode speed, file size, memory usage, seeking performance

## Performance Targets

| Metric                | Target           | Environment        |
|-----------------------|------------------|--------------------|
| Frame budget (30fps)  | 33.3ms           | 1920×1080          |
| Frame budget (60fps)  | 16.7ms           | 1920×1080          |
| p95 frame time        | < 33ms           | 2-3 effects, 30fps |
| Decode time           | < 10ms (p50)     | ProRes 4444        |
| GPU upload            | < 5ms (p50)      | RGBA texture       |
| Composite render      | < 10ms (p50)     | Single effect      |
| Memory (3 effects)    | < 500MB growth   | Bounded cache      |

## References

### Existing Clypra Architecture
- `ClipEffect` and `ClipOverlay` types
- `multi_track_composer.rs` (compositor)
- `effect_interpreter.rs` (effect execution)
- FFmpeg decoder integration
- wgpu rendering pipeline
- Text animation publishing workflow

### Technical Documentation
- FFmpeg ProRes 4444 alpha handling
- wgpu alpha blending modes
- Cloudflare R2 presigned URLs
- Content-addressed caching strategies

## Next Steps

1. **Kiro executes Phase 0:** Deliver all 5 required artifacts
2. **Architecture review:** Approve Phase 0 deliverables
3. **Kiro implements Phase 1:** Prove local rendering
4. **Weekly progress reviews:** Track implementation milestones

---

**Approved By:** Human (Senior Architect)  
**Implementation Lead:** Kiro AI Agent  
**Review Cadence:** Weekly architecture reviews during development

