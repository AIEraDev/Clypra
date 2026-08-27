# Clypra Text Effects — From-Scratch Architecture

## 0. Foundational Decisions

1. **SDF (Signed Distance Field) Text Representation**, not raster/alpha-mask.
   Resolution-independent, enables real glow, bevel, 3D extrude, and outline quality that
   holds up under arbitrary scale and camera animation.
2. **Composable Primitive Toolkit as the Default Authoring Path.** Most
   effects are *data* (an ordered list of primitive passes + parameter bindings), not
   hand-written WGSL. Hand-written shaders remain a strictly reviewed engine-level escape hatch
   for novel techniques, not the contribution path.
3. **Strict Code vs. Data Boundary.** Studio (web) and the Tauri desktop
   app are separate runtime environments. Neither package bundles any effect
   *compositions*. Only the primitive toolkit and interpreter ship with the
   app/package. Effect compositions are fetched from the API at runtime and
   cached content-addressed by ID and version.

---

## 1. Package / API Boundary & Trust Model

```
┌────────────────────────────────────────────────────────┐
│                   SHIPPED CODE                         │
│  (clypra-native-core, clypra-render-wasm, src-tauri)   │
│                                                        │
│  • Glyph Shaping (cosmic-text / swash)                 │
│  • High-Res SDF Distance Transform Generator           │
│  • Whitelisted Primitive Pass Toolkit (WGSL shaders)   │
│  • Pass-Chain Execution Interpreter & Ingestion Guard  │
│  • Static Raster Output Cache (VRAM texture reuse)     │
└──────────────────────────▲─────────────────────────────┘
                           │ executes
┌──────────────────────────┴─────────────────────────────┐
│                   RUNTIME DATA                         │
│        (Clypra API: Cloudflare Workers + R2/KV)        │
│                                                        │
│  • EffectDefinition records (ID, Version, Passes, UI)  │
│  • Pure declarative JSON: zero executable logic        │
│  • Catalog index, categories, and curated thumbnails   │
└────────────────────────────────────────────────────────┘
```

### 1.1 Hard Security Invariant & Dynamic Tiering Resource Bounds

The interpreter must be structurally incapable of executing anything beyond a whitelisted set of primitive IDs, with bounded, typed parameters validated against `ParamSpec` before GPU execution.

1. **Primitive Whitelist**: An `EffectDefinition` fetched from the API can only reference `primitive_id` values compiled into the shipped binary. Unknown IDs trigger immediate rejection of the entire effect chain.
2. **Parameter Sanitization & Bounds**:
   - Float values must be finite (reject `NaN`, `+Inf`, `-Inf`).
   - Floats and integers are clamped or rejected if outside declared `[min, max]` ranges.
   - Enums are strictly matched against known variants.
   - Zero dynamic string concatenation into WGSL shaders; parameters are passed strictly via uniform buffers.
3. **Sequential Execution Semantics & Dynamic Resolution Tiering**:
   - **Strict Sequential Order**: Every pass $i \in [1, N]$ operates on the evolving intermediate texture produced by pass $i-1$ (with pass 1 taking the shaped glyph distance field).
   - **Dynamic Resolution Buckets**: The interpreter tracks the intermediate texture's active descriptor: `TightFullRes` ($1984 \times 464\text{px} \approx 0.92\text{M}$ px at 4K), `WideQuarterRes` ($736 \times 356\text{px} \approx 0.26\text{M}$ px), or `WideFullRes` ($2944 \times 1424\text{px} \approx 4.19\text{M}$ px).
     - When a wide blur/glow ($R > 64\text{px}$) is encountered, the interpreter resamples the current intermediate to `WideQuarterRes`.
     - When a subsequent full-res spatial pass (e.g. `chromatic_shift`, `color_grade`, `outline`) follows the blur, the interpreter upsamples the intermediate to `WideFullRes` and continues sequential execution.
   - **Authoring Rule (At Most One Contiguous Wide-Tier Excursion)**: At most **2 resolution tier transitions** (`Tight` $\to$ `QuarterRes` $\to$ `WideFullRes`) are permitted per chain. In authoring terms: all wide-blur work must be contiguous in the effect sequence; multiple disconnected wide-blur passes separated by full-res passes are rejected by the validator.
   - **Worst-Case Bandwidth Model (8 Tight Passes + 1 Downsample + 2 Quarter-Res Blurs + 1 Upsample + 4 Late Wide Passes)**:
     - 8 Tight Core Passes ($0.92\text{M}$ px): $8 \times 0.92\text{M} \times 4\text{B} \times 2 = 58.9\text{ MB}$
     - 1 Downsample Pass: $(0.92 + 0.26)\text{M} \times 4\text{B} = 4.7\text{ MB}$
     - 2 Quarter-Res Blur Passes ($0.26\text{M}$ px): $2 \times 0.26\text{M} \times 4\text{B} \times 2 = 4.2\text{ MB}$
     - 1 Upsample Pass: $(0.26 + 4.19)\text{M} \times 4\text{B} = 17.8\text{ MB}$
     - 4 Late Wide-FullRes Passes ($4.19\text{M}$ px): $4 \times 4.19\text{M} \times 4\text{B} \times 2 = 134.1\text{ MB}$
     - **Total Worst-Case Bandwidth**: $\mathbf{219.7\text{ MB}}$ (RGBA8 SDR).
     - **Frame Time Performance**:
       - 40 GB/s integrated GPU (Intel Iris Xe): $\approx \mathbf{5.5\text{ ms}}$ (well within the $16.6\text{ms}$ 60fps budget).
       - 68 GB/s Apple Silicon (M1/M2/M3): $\approx \mathbf{3.2\text{ ms}}$.
       - $\ge 360\text{ GB/s}$ discrete GPU: $\approx \mathbf{0.6\text{ ms}}$.
4. **Pixel Format Contract (RGBA8 vs RGBA16F)**:
   - **Standard SDR (Default)**: Intermediate ping-pong buffers execute in `Rgba8Unorm` (4 bytes/pixel). All baseline 60fps real-time latency budgets apply to RGBA8.
   - **HDR Wide-Gamut (Opt-in via ColorPolicy)**: When `ColorPolicy.output_format == PixelFormat::Rgba16Float`, intermediate passes allocate `Rgba16Float` (8 bytes/pixel), doubling bandwidth to $\approx 439\text{MB}$ worst-case. Documented for modern Apple Silicon unified memory or discrete GPU systems.
5. **No Remote Code Execution**: Escape-hatch custom WGSL shaders must be compiled Rust/WASM code reviewed through standard repository PRs. The API can compose existing primitives; it can never deliver new shader source code.

### 1.2 Offline, Caching & Export Policy

The desktop app and web studio must provide a reliable offline experience while strictly enforcing Clypra's [Architecture-First ADR](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/architecture-first-delivery-adr.md) (*"Silent fallback is not an acceptable production failure policy"*):

- **Storage Location**:
  - Desktop: Content-addressed cache directory (`~/.clypra/cache/text-effects/{id}_v{version}.json`).
  - Web Studio: IndexedDB (`clypra_effects_store`).
- **Cache Lifecycle**:
  - **Fetch-on-Browse**: Opening the text effects library panel pre-fetches and caches definitions for visible items.
  - **Fetch-on-Apply**: Applying an effect to a timeline clip guarantees the definition is written to disk.
  - **Immutable by Version**: Cache entries are keyed by `id + version`. Definitions for a given version never mutate.
- **Interactive Preview vs. Export Behavior**:
  - **Timeline Preview (Degraded Graceful Editing)**: If an effect is un-cached and offline during preview, the compositor falls back to base SDF typography (default fill) so the user can continue editing other tracks without interruption. The inspector shows an indicator: `Offline: Neon Glow (v2) not cached`.
  - **Export Pre-flight Gate (Strict Blocking by Default)**:
    - Exporting runs `verify_export_dependencies()`.
    - If any text effect in the sequence is missing from local cache and network is unreachable, **export is blocked** with a clear modal:
      ```text
      ⚠️ Export Blocked: Missing Text Effect Definition
      The text effect "Neon Glow (v2)" on clip "Title 1" is not cached locally and the network is unavailable.
      
      [ Cancel Export (Recommended) ]   [ Retry Connection ]   [ Force Export with Base Typography ]
      ```
    - "Force Export" requires explicit opt-in confirmation and logs the degradation to the export manifest.

### 1.3 Effect Versioning & Zero-Trust `parameterOverrides` Ingestion

Each `EffectDefinition` contains a monotonically increasing `version: u32`. When a clip applies an effect, it pins the exact version and stores user customizations as first-class `parameterOverrides`:

```json
{
  "clipId": "clip-text-104",
  "text": "Cyberpunk 2088",
  "effectId": "neon-glow",
  "effectVersion": 2,
  "parameterOverrides": {
    "glowColor": [0.0, 1.0, 0.8, 1.0],
    "glowRadius": 45.0
  }
}
```

#### Zero-Trust Project Ingestion & Sanitization Lifecycle
Project JSON, templates, and imported clips come from external/untrusted sources. The native interpreter (`clypra-native-core` and `clypra-render-wasm`) enforces strict validation at ingestion:

1. **Lifecycle & Caching**: Sanitization runs **once per clip/revision load or parameter mutation**. The resulting validated uniform buffer is cached on the clip session. Steady-state 60fps playback binds the resident uniform buffer directly without per-frame re-parsing or string comparisons.
2. **Key Whitelisting**: Any key in `parameter_overrides` not declared in the pinned `EffectDefinition.parameters` is discarded.
3. **Type Variant Matching**: The override `ParamValue` variant must match the declared `ParamKind` (e.g. attempting to pass a string or matrix to a `Color` or `Float` uniform is rejected and replaced with the definition default).
4. **Finite Float & Clamping**: Non-finite numbers (`NaN`, $+\infty$, $-\infty$) are replaced with defaults; numbers are clamped strictly to `[range.min, range.max]`.
5. **Resolution Precedence**: `ParamSpec.default` $\to$ `PrimitivePass.param_bindings` $\to$ `TextEffectInstance.parameter_overrides` (sanitized).

---

## 2. Core Rendering Pipeline & Native Integration

```
Text Content + Font Identifier + Sanitized Parameter Overrides
        │
        ▼
Glyph Shaping (cosmic-text)
  • Bounding box calculation, glyph layout, and line wrapping
        │
        ▼
SDF Generation Pass (swash -> Distance Transform)
  • Cached by (FontHash + GlyphID + TargetSize)
        │
        ▼
Native Text Layer Cache Check
  • Key: (TextHash + FontHash + EffectID + Version + OverridesHash + CanvasScale)
  • Hit: Return cached GPU Texture directly ($0.02ms blit)
  • Miss: Execute Pass-Chain Interpreter below
        │
        ▼
Pass-Chain Interpreter (wgpu)
  • Ingests sanitized parameters into Uniform Buffers
  • Executes passes in authored sequential order [Pass 1 ... Pass N]
  • Dynamically transitions intermediate buffers across resolution tiers:
    - TightFullRes (1984x464) for local SDF / contour passes
    - WideQuarterRes (736x356) for wide blurs (R > 64px)
    - WideFullRes (2944x1424) for downstream full-res spatial post-FX
        │
        ▼
Store in Text Layer Raster Cache & Hand to MultiTrackCompositor
  • Outputs RGBA8 (or RGBA16F HDR) into native frame graph

Desktop contract note: the Tauri authority receives resolved text snapshots,
including font variant, panel, stroke/shadow, karaoke-run, template, and
effect-pass data. Missing fonts and malformed/unknown effect primitives fail
the native request. Browser/WASM text rendering remains a separate runtime.
```

---

## 3. The Primitive Toolkit

Each primitive is implemented as a single, portable WGSL fragment shader compiled into `clypra-native-core` and `clypra-render-wasm`:

| Primitive ID | Purpose | Uniform Inputs |
|---|---|---|
| `distance_threshold` | Hard/soft edge cutoff from SDF | `threshold: f32`, `smoothness: f32`, `color: vec4` |
| `outline_from_distance` | Ring stroke around glyph contours | `offset: f32`, `thickness: f32`, `feather: f32`, `color: vec4` |
| `glow_from_distance` | Exponential/Gaussian outward falloff | `radius: f32`, `intensity: f32`, `color: vec4` |
| `bevel_from_distance` | Normal derivation & specular lighting | `angle: f32`, `elevation: f32`, `depth: f32`, `light_color: vec4` |
| `gradient_map` | Color ramp remapping (linear/radial/angle) | `ramp_stops: array<vec4, 8>`, `stops_count: u32`, `direction: vec2` |
| `noise_displace` | Perlin/Simplex coordinate perturbation | `frequency: f32`, `amplitude: f32`, `octaves: u32`, `seed: f32` |
| `chromatic_shift` | Split R, G, B channel offsets | `offset_r: vec2`, `offset_g: vec2`, `offset_b: vec2`, `intensity: f32` |
| `drop_shadow` | Offset, blurred glyph silhouette | `offset: vec2`, `blur_radius: f32`, `opacity: f32`, `color: vec4` |
| `blur` | Separable dual-pass multi-scale Gaussian blur | `radius: f32`, `direction: vec2`, `downsample_level: u32` |
| `color_grade` | Hue, saturation, contrast, vignette | `exposure: f32`, `contrast: f32`, `saturation: f32`, `hue_rotate: f32` |

---

## 4. Schema Specifications

### 4.1 Effect Definition & Instance Schema (Native & API)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectDefinition {
    pub id: String,
    pub version: u32,
    pub display_name: String,
    pub category: String,
    pub description: String,
    pub passes: Vec<PrimitivePass>,
    pub parameters: Vec<ParamSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEffectInstance {
    pub effect_id: String,
    pub effect_version: u32,
    #[serde(default)]
    pub parameter_overrides: HashMap<String, ParamValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimitivePass {
    pub primitive_id: String,
    pub blend_mode: String, // "normal", "additive", "multiply", "screen", "overlay"
    pub param_bindings: HashMap<String, ParamBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ParamBinding {
    Constant { value: ParamValue },
    Exposed { param_key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamSpec {
    pub key: String,
    pub label: String,
    pub kind: ParamKind,
    #[serde(default)]
    pub range: Option<[f32; 2]>,
    pub default: ParamValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParamKind {
    Float,
    Color,
    Vec2,
    Angle,
    Choice { options: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    Float(f32),
    Color([f32; 4]),
    Vec2([f32; 2]),
    String(String),
}
```

---

## 5. Multi-Surface Integration Architecture

### 5.1 Desktop Tauri Integration & Frame Caching
- **Compositor Authority**: `MultiTrackCompositor` (`clypra-native-core` / `src-tauri/src/wgpu_compositor/`) evaluates text layers via the native `wgpu` pipeline.
- **VRAM Raster Output Cache**: When text content, font properties, and sanitized parameter overrides are unchanged across frames, `MultiTrackCompositor` skips the pass-chain execution and reuses the cached GPU texture.
- **Telemetry Separation**: Cache hits are tracked as `text_layer_cache_hits` in `NativeFrameServiceStats`, preventing static text blits from skewing video decode/compositing performance metrics.

### 5.2 Web Studio & Live "Effect Lab" Authoring
- **Shared WASM Interpreter**: Studio consumes `@clypra/render-wasm`, which compiles the identical Rust `wgpu` pass-chain interpreter to WebGPU/WebGL via `wasm-bindgen`.
- **Dual Data Sources, Identical Render Path**:
  - *Timeline Playback*: Feeds API-fetched, version-pinned `EffectDefinition` records from local cache.
  - *Effect Lab Authoring*: Feeds an in-memory draft `EffectDefinition` directly to the same WASM interpreter, enabling live preview as parameters are adjusted.

### 5.3 API & Thumbnail Rendering Authority
- **Client-Rendered with Moderation Verification**:
  1. **Upload Time**: The authoring client's WASM engine renders a canonical $512 \times 512$ PNG preview of the effect applied to `"Aa / Clypra"` and uploads it via `POST /text-effects/upload`.
  2. **Moderator Preview Gate**: The admin review UI in Studio Labs renders the uploaded JSON with its own WASM engine to guarantee the preview matches the actual composition before approving.
  3. **Publish Invalidation**: Upon approval via `POST /:category/:id/publish`, the verified thumbnail and definition are promoted to the public R2 bucket (`text-effects/{category}/{id}.png`).

---

## 6. Font Bundling & Cross-Platform Parity

To eliminate typography discrepancy between Web (WASM) and Desktop (Tauri):
1. **Core Standard Fonts** (Inter, Roboto, Montserrat, Oswald, Bebas Neue, Playfair Display) are served via CDN alongside the WASM binary and cached in the browser CacheStorage / local app storage.
2. `cosmic-text` is fed raw `&[u8]` font buffer data identically on both Web and Native.
3. System fonts are discovered locally on desktop and fall back to bundled equivalents in Web Studio.

---

## 7. Parity Verification & Golden-Pixel Harness

In accordance with Clypra's [Golden-Frame Protocol](file:///Users/AIEraDev/Documents/clypra-family/clypra/docs/golden-frame-protocol.md):

1. **Primitive Fixture Suite**:
   - Every primitive from §3 is evaluated with a canonical test string ("Clypra FX 4K") and deterministic uniforms.
   - Rendered outputs from `clypra-native-core` and `clypra-render-wasm` are compared with maximum pixel tolerance (`deltaE < 1.0`, zero matrix or alpha drift).
2. **Interpreter Composition Fixture Suite**:
   - Tests complex multi-pass chains with edge-case parameters (0.0 radius, extreme coordinates, maximum 16-pass length).
3. **Security & Ingestion Negative CI Tests**:
   - Rejection test: Passing an unregistered `primitive_id` returns `Err(NativeCoreError::InvalidPrimitive)`.
   - Rejection test: Passing `NaN` or `+Inf` floats returns `Err(NativeCoreError::InvalidParameter)`.
   - Rejection test: Passing a 17-pass definition returns `Err(NativeCoreError::PassChainLengthExceeded)`.
   - Rejection test: Exceeding 2 resolution tier transitions (non-contiguous wide blur passes) returns `Err(NativeCoreError::TierTransitionLimitExceeded)`.
   - Rejection test: Malicious `parameter_overrides` (invalid keys, out-of-range values, type mismatches) are sanitized and clamped without crashing.

---

## 8. Contribution & Zero-Trust Server-Side Validation Pipeline

```
┌────────────────────────────────────────────────────────────┐
│                    EFFECT AUTHORING                        │
│  Author builds composition in Studio "Effect Lab" UI       │
│  (composes existing primitives + adjusts parameters)       │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                  CLIENT-SIDE VALIDATION (UX)               │
│  Runs EffectValidator (schema, bounds, whitelist check)    │
│  Renders canonical 512x512 thumbnail via WASM interpreter  │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│          SERVER-SIDE VALIDATION GATE (Zero-Trust)          │
│  POST /text-effects/upload                                 │
│  • Server validates schema, primitive whitelist, bounds   │
│  • Rejects invalid payloads with HTTP 400                  │
│  • Stores valid JSON in R2 with published: false           │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│               ADMIN MODERATION / REVIEW QUEUE              │
│  • Admin renders JSON live in Studio Labs to verify match  │
│  • Server re-validates before promoting to production      │
│  • POST /text-effects/:category/:id/publish (sets true)    │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                     PUBLIC CATALOG                         │
│  Available to all Studio & Native desktop users            │
└─────────────────────────────┴──────────────────────────────┘
```

---

## 9. Phased Implementation Roadmap

1. **Phase 1: SDF Generation & Glyph Cache**: Integrate `swash` distance transform with `cosmic-text` and establish glyph SDF cache.
2. **Phase 2: Core Toolkit WGSL Shaders**: Implement initial 4 primitives (`distance_threshold`, `outline_from_distance`, `glow_from_distance`, `drop_shadow`).
3. **Phase 3: Pass-Chain Interpreter, Dynamic Tiering & Raster Cache**: Implement `EffectInterpreter` in `clypra-native-core` and `clypra-render-wasm` with sequential execution semantics, dynamic resolution tier transitions ($\le 2$ transitions), parameter override caching, static VRAM raster caching, and 16-pass ceiling.
4. **Phase 4: API Server-Side Validation & Local Caching Layer**: Implement server-side `validateEffectPayload` in `clypra-api` and wire local content-addressed disk/IndexedDB cache.
5. **Phase 5: Golden-Pixel CI Harness**: Add text effect fixture suite and security negative tests.
6. **Phase 6: Full Primitive Set**: Implement remaining 6 primitives (`bevel_from_distance`, `gradient_map`, `noise_displace`, `chromatic_shift`, `blur`, `color_grade`).
7. **Phase 7: Curated Effect Catalog Launch**: Publish the initial 7 bread-and-butter effects (Clean Outline, Neon Glow, Drop Shadow, Gradient Fill, 3D Bevel, Glitch, Retro/VHS).
8. **Phase 8: Effect Lab & Moderation Pipeline**: Enable user submissions via Studio Lab.
