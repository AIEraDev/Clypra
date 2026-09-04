# Clypra Clean Architecture & Domain Boundary Invariants

## 1. Core Principle: Zero Domain Cross-Contamination

In Clypra's architecture, **violation of domain boundaries is strictly prohibited**. 

Every creative solution in Clypra (Text Effects, Text Templates, Video Effects, Transitions, Stickers, and Smart Overlays) is an autonomous domain. Each domain represents a distinct creative capability with specialized data structures, compilation passes, authoring constraints, and execution requirements.

**Under no circumstances may one solution inherit, wrap, or alias the AST schema or compiler of another solution.**

```
                                    ┌────────────────────────┐
                                    │    Clypra Studio UI    │
                                    └───────────┬────────────┘
                                                │ (routes / lab views)
         ┌───────────────┬──────────────────────┼──────────────────────┬────────────────┐
         ▼               ▼                      ▼                      ▼                ▼
   ┌───────────┐   ┌────────────┐        ┌─────────────┐        ┌─────────────┐   ┌────────────┐
   │Text Effect│   │Video Effect│        │ Text-Motion │        │Smart Overlay│   │ Transitions│
   │    Lab    │   │  Sandbox   │        │  Templates  │        │     Lab     │   │    Lab     │
   └─────┬─────┘   └─────┬──────┘        └──────┬──────┘        └──────┬──────┘   └─────┬──────┘
         │               │                      │                      │                │
   ┌─────▼─────┐   ┌─────▼──────┐        ┌──────▼──────┐        ┌──────▼──────┐   ┌─────▼──────┐
   │TextEffect │   │EffectGraph │        │TextTemplate │        │OverlayDoc   │   │Transition  │
   │  Schema   │   │   Schema   │        │Artifact (V4)│        │   Schema    │   │ Definition │
   └─────┬─────┘   └─────┬──────┘        └──────┬──────┘        └──────┬──────┘   └─────┬──────┘
         │               │                      │                      │                │
         │ (eval)        │ (shader pass)        │ (template eval)      │ (layout engine)│ (wipe)
         ▼               ▼                      ▼                      ▼                ▼
   ┌────────────────────────────────────────────────────────────────────────────────────┐
   │             Unified Hardware Execution Layer (clypra-render-wasm v2)               │
   │             • WebGPU Hardware-Accelerated Compositor / Shader Passes               │
   │             • Standardized Texture / Raster Frame Contract                         │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Domain Isolation Matrix

| Creative Solution | Dedicated Domain Schema | Core Primitives & Capabilities | Execution & Render Engine |
|---|---|---|---|
| **Text Effects Lab** | `TextEffectConfig` / `TextEffectDefinition` | Style presets, multi-phase kinetic animations, SDF shaders, per-character styling | Canvas2D Text Renderer / SDF pass chain |
| **Video Effects Lab** | `EffectGraph` / `EffectNode` | DAG node graph, shader parameters, blur/glow passes, blend modes | WebGPU Shader Graph |
| **Transitions Lab** | `TransitionDefinition` / `TransitionConfig` | Directional wipes, dissolves, motion blur shaders, time progress | GLSL / WebGPU Transition Shaders |
| **Stickers Lab** | Lottie AST / Vector Asset Schema | Vector paths, Bodymovin keyframe markers, dynamic color slots | `lottie-web` / Skia engine |
| **Smart Overlays Lab** | `OverlayDocument` / `SceneNode` | Dynamic data repeaters, live data expressions, analytics charts, tables, gauges | Smart Overlay Layout Engine |
| **Text-Motion Templates** | **`TextTemplateArtifact` / `TextTemplateDocument`** | Text/Shape/Image layers, Split-Animators, Bezier Keyframes, Responsive Anchors, Template Variables | `TemplateRenderer` → `clypra-render-wasm` |

---

## 3. Mandatory Architectural Invariants

### 3.1 Schema Independence Invariant
1. **No Domain Inheritance**: A domain's schema (e.g., `TextTemplateDocument`) must NEVER extend another domain's schema (e.g., `OverlayDocument`).
2. **Dedicated Node Types**: Text template layer nodes (`TemplateTextLayerNode`, `TemplateShapeLayerNode`, `TemplateImageLayerNode`) must be defined natively within `textTemplates/`. They must NOT import `SceneNode` from `smartOverlays/`.
3. **Domain-Specific Feature Flags**: Features unique to text templates (such as kinetic `splitAnimator`, dynamic `{{variable}}` substitution, and `auto` content-driven dimensions) belong strictly in `textTemplates/` and must not pollute `smartOverlays/`.

### 3.2 Compiler & Validator Independence Invariant
1. **Self-Contained Evaluation**: `textTemplates/compiler.ts` must evaluate text templates using the native template motion engine (`TemplateRenderer`), NOT by calling `evaluateOverlayDocument()`.
2. **Domain-Targeted Diagnostics**: Validation errors must reflect template semantics (`TEMPLATE_VARIABLE_MISSING`, `INVALID_KEYFRAME_CURVE`), completely independent of smart overlay data-binding checks.

### 3.3 Hardware Convergence at the Native Render Contract
1. **Standardized Frame Payloads**: All domains interface with the GPU compositor through `clypra-render-wasm` (contract version 2) using standard `NativeLabFrameRequest` (raster layers, video textures, or shader graphs).
2. **Zero Leaky Abstractions**: Engine internals remain isolated; changes made to optimize one feature (e.g., adding a new chart type to Smart Overlays) cannot break or alter another feature (e.g., Text Templates).

---

## 4. Architectural Decoupling Roadmap: Text Templates

To eliminate the legacy coupling between Text Templates and Smart Overlays:

1. **`src/textTemplates/contract.ts`**:
   - Define self-contained `TextTemplateDocument` and `TemplateLayerNode` types.
   - Remove all imports from `../smartOverlays/overlayDocumentSchema.js` and `../smartOverlays/runtime/evaluatedScene.js`.

2. **`src/textTemplates/normalize.ts`**:
   - Normalize `TextTemplate` directly into `TextTemplateArtifact` without converting to `SceneNode`.

3. **`src/textTemplates/validator.ts`**:
   - Validate native template structures, layers, keyframes, animators, and variables directly.

4. **`src/textTemplates/compiler.ts`**:
   - Compile `TextTemplateArtifact` directly using `TemplateRenderer`, producing `CompiledTextTemplate` for `clypra-render-wasm`.

5. **`src/smartOverlays/` Hardening**:
   - Revert `smartOverlays/overlayDocumentSchema.ts` and its layout engines to pure, strict numeric bounds tailored for broadcast data widgets.
