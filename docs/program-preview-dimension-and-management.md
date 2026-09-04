# Program Preview Dimension & Multi-Format Management Architecture

## 1. Executive Summary & Problem Context

In modern video editing, timelines frequently contain media from disparate sources:
- **16:9 Landscape Video**: 4K UHD ($3840 \times 2160$), 1080p ($1920 \times 1080$), 720p ($1280 \times 720$).
- **9:16 Vertical Video**: Smartphone capture ($1080 \times 1920$, $2160 \times 3840$, $720 \times 1280$).
- **1:1 Square & 4:5 Social Formats**: Instagram / carousel posts ($1080 \times 1080$, $1080 \times 1350$).
- **21:9 Ultra-Widescreen & Anamorphic**: Cinema scope ($2520 \times 1080$, $3840 \times 1600$, non-square Sample Aspect Ratio $\text{SAR} \ne 1:1$).
- **Mobile Container Rotation**: Videos shot vertically where the raw macroblock stream is encoded as $1920 \times 1080$ with a container metadata rotation tag ($90^\circ$ or $270^\circ$).

Professional Non-Linear Editors (NLEs) such as **DaVinci Resolve**, **Adobe Premiere Pro**, and **Apple Final Cut Pro** handle these mixed dimensions seamlessly by maintaining a strict, decoupled **4-Tier Coordinate Hierarchy**.

This document outlines Clypra's architectural solution for Program Preview dimension management, ensuring high-end editing fidelity without aspect ratio distortion, subpixel blurring, or coordinate desynchronization.

---

## 2. The 4-Tier Coordinate & Dimension Architecture

```
+-----------------------------------------------------------------------------------+
| 1. SOURCE MEDIA SPACE (Raw Encoded Asset)                                         |
|    Dimensions: (W_src, H_src)                                                     |
|    Attributes: Sample Aspect Ratio (SAR), Container Rotation (0°, 90°, 180°, 270°) |
+-----------------------------------------------------------------------------------+
                                          │
                      [Spatial Conform: Fit / Fill / Stretch / None]
                      [Geometry Normalization: SAR & Rotation Unpack]
                                          ▼
+-----------------------------------------------------------------------------------+
| 2. TIMELINE CANVAS SPACE (Ground Truth Sequence Space)                            |
|    Dimensions: (W_canvas, H_canvas) e.g., 1920x1080 (16:9) or 1080x1920 (9:16)    |
|    Coordinates: Absolute canvas coordinates [0..W_canvas, 0..H_canvas]            |
|    Layers: Base Conform + User Transforms (Scale, Nudge, Rotation) + Keyframe Curves|
+-----------------------------------------------------------------------------------+
                                          │
                      [Display Transform: Aspect Preservation & Matte]
                      [Viewport Zoom (Fit / 50% / 100% / 200%) & Pan]
                                          ▼
+-----------------------------------------------------------------------------------+
| 3. PROGRAM MONITOR VIEWPORT SPACE (UI Viewer Container)                           |
|    Container: (W_container, H_container)                                         |
|    Matte: Letterbox (top/bottom) or Pillarbox (left/right) black bars             |
|    Display Canvas: (W_display, H_display) scaled uniformly                        |
+-----------------------------------------------------------------------------------+
                                          │
                      [Retina / HiDPI Device Pixel Ratio (DPR)]
                      [Fractional Preview Resolution Scaling (Full / 1/2 / 1/4)]
                                          ▼
+-----------------------------------------------------------------------------------+
| 4. HARDWARE PRESENTATION SURFACE (WGPU Swapchain & Native NSView)                 |
|    Physical Dimensions: (W_phys, H_phys) = round(W_display * DPR, H_display * DPR)|
|    Rendering: 1:1 hardware pixel mapping without bilinear blur                   |
|    Projection: Normalized Device Coordinates [-1.0, 1.0]                          |
+-----------------------------------------------------------------------------------+
```

---

## 3. Spatial Conform Engine

When a media asset of dimensions $(S_w, S_h)$ is placed on a timeline of dimensions $(W_c, H_c)$, its base placement is calculated deterministically by the Spatial Conform Engine (`resolveConform`).

### 3.1 Conform Modes & Mathematical Specifications

Let:
- $W_c = \text{canvasWidth}$
- $H_c = \text{canvasHeight}$
- $S_w = \text{sourceWidth}$
- $S_h = \text{sourceHeight}$
- $U_s = \text{userScale}$ (default: $1.0$)
- $U_x = \text{userOffsetX}$ (default: $0.0$)
- $U_y = \text{userOffsetY}$ (default: $0.0$)

#### Mode 1: `fit` (Scale to Fit / Contain)
The entire clip is visible within the canvas. Aspect ratio is preserved. Unfilled canvas areas appear as pillarbox (left/right) or letterbox (top/bottom).
$$\text{scale}_{\text{base}} = \min\left(\frac{W_c}{S_w}, \frac{H_c}{S_h}\right)$$
$$W = S_w \times \text{scale}_{\text{base}} \times U_s, \quad H = S_h \times \text{scale}_{\text{base}} \times U_s$$
$$X = \frac{W_c - W}{2} + U_x, \quad Y = \frac{H_c - H}{2} + U_y$$

#### Mode 2: `fill` (Scale to Fill / Cover)
The clip scales uniformly until it completely fills the canvas. Aspect ratio is preserved. Excess content overflows the canvas and is clipped.
$$\text{scale}_{\text{base}} = \max\left(\frac{W_c}{S_w}, \frac{H_c}{S_h}\right)$$
$$W = S_w \times \text{scale}_{\text{base}} \times U_s, \quad H = S_h \times \text{scale}_{\text{base}} \times U_s$$
$$X = \frac{W_c - W}{2} + U_x, \quad Y = \frac{H_c - H}{2} + U_y$$

#### Mode 3: `stretch` (Distort to Match Canvas)
The clip scales non-uniformly to match canvas dimensions exactly. Aspect ratio is distorted if source does not match sequence.
$$W = W_c \times U_s, \quad H = H_c \times U_s$$
$$X = \frac{W_c - W}{2} + U_x, \quad Y = \frac{H_c - H}{2} + U_y$$

#### Mode 4: `none` (1:1 Native Pixel Mapping)
One source pixel equals one sequence canvas pixel. No base scaling occurs.
$$W = S_w \times U_s, \quad H = S_h \times U_s$$
$$X = \frac{W_c - W}{2} + U_x, \quad Y = \frac{H_c - H}{2} + U_y$$

---

## 4. Keyframe Animation & Conform Composition

### The Architectural Invariant
> **Invariant 1**: Spatial conform establishes the **resting baseline geometry** ($X_{\text{base}}, Y_{\text{base}}, W_{\text{base}}, H_{\text{base}}$). User keyframes animate properties **on top of** this baseline. Conform must never erase keyframes.

In `src/core/evaluation/evaluator.ts`:
```typescript
if (clip.conform && clip.conform.sourceWidth && clip.conform.sourceHeight) {
  const conformed = resolveConform(
    clip.conform,
    project?.canvasWidth ?? 1920,
    project?.canvasHeight ?? 1080,
  );
  evalX = kf.x !== undefined ? evalX : conformed.x;
  evalY = kf.y !== undefined ? evalY : conformed.y;
  evalW = kf.width !== undefined ? evalW : conformed.width;
  evalH = kf.height !== undefined ? evalH : conformed.height;
}
```
If an editor animates keyframes on $X$, $Y$, Width, or Height, those keyframed values take precedence at the given time offset. Un-keyframed properties remain anchored to the conformed resting geometry.

---

## 5. Timeline Canvas Aspect Ratio Switching

When an editor changes sequence settings (e.g. from 16:9 $1920 \times 1080$ to 9:16 $1080 \times 1920$ for TikTok/Shorts/Reels):

### 5.1 Dual-Model Refit Pipeline (`refitClipsForCanvasChange`)
In professional NLEs, changing sequence aspect ratio refits existing clips according to their assigned conform mode without losing manual position nudges.

Clypra synchronizes both the clip dimension cache (`clip.x, clip.y, clip.width, clip.height`) AND the authoritative conform model (`clip.conform`):
1. **User Offsets Scale Proportionally**:
   $$\text{scale}_X = \frac{W_{\text{new}}}{W_{\text{old}}}, \quad \text{scale}_Y = \frac{H_{\text{new}}}{H_{\text{old}}}$$
   $$\text{userOffsetX}_{\text{new}} = \text{userOffsetX}_{\text{old}} \times \text{scale}_X$$
   $$\text{userOffsetY}_{\text{new}} = \text{userOffsetY}_{\text{old}} \times \text{scale}_Y$$
2. **Conform Mode Synchronization**:
   `clip.conform.mode` is synchronized with `clip.fitMode` (`fit`, `fill`, `stretch`, `none`).
3. **Dual Persistence**:
   Both `newDims` and `nextConform` are committed together in `updateClip`, preventing state desynchronization between the timeline model and the evaluator.

---

## 6. Program Monitor Viewport & Fractional Preview Scaling

### 6.1 Viewport Matte (Letterbox / Pillarbox)
The Program Monitor window has dynamic dimensions $(W_{\text{container}}, H_{\text{container}})$ based on pane docking and resizing.

The canvas is centered with uniform aspect ratio preservation:
$$\text{scale}_{\text{base}} = \min\left(\frac{W_{\text{container}}}{W_{\text{canvas}}}, \frac{H_{\text{container}}}{H_{\text{canvas}}}\right)$$
$$W_{\text{display}} = W_{\text{canvas}} \times \text{scale}_{\text{base}} \times \text{zoom}$$
$$H_{\text{display}} = H_{\text{canvas}} \times \text{scale}_{\text{base}} \times \text{zoom}$$
$$\text{offsetX} = \frac{W_{\text{container}} - W_{\text{display}}}{2} + \text{panX}$$
$$\text{offsetY} = \frac{H_{\text{container}} - H_{\text{display}}}{2} + \text{panY}$$

Any unused area within the viewer pane is rendered as a clean matte background void.

### 6.2 Strict Fractional Preview Aspect-Ratio Lock
During playback and scrubbing, `PreviewQualityManager` selects fractional render profiles ($75\%$, $50\%$, $25\%$) to minimize GPU VRAM bandwidth and sustain real-time playback:

> **Invariant 2**: All preview quality tiers must compute `maxWidth` and `maxHeight` with an exact aspect-ratio lock:
> $$\text{maxHeight} = \text{round}\left(\text{maxWidth} \times \frac{\text{sequenceHeight}}{\text{sequenceWidth}}\right)$$

This guarantees that:
$$\frac{\text{output\_width}}{\text{canvas\_width}} = \frac{\text{output\_height}}{\text{canvas\_height}}$$
preventing non-uniform stretching or squishing of layers during fractional playback.

---

## 7. WGPU Compositing & Surface Geometry

### 7.1 Normalized Device Coordinate (NDC) Transformation
In `src-tauri/src/commands/native_preview.rs` and `multi_track_composer.rs`:
Canvas coordinates are mapped into normalized clip space $[-1.0, 1.0]$:
$$\text{translate}_x = \left(\frac{X + \frac{W}{2}}{W_{\text{canvas}}}\right) \times 2.0 - 1.0$$
$$\text{translate}_y = 1.0 - \left(\frac{Y + \frac{H}{2}}{H_{\text{canvas}}}\right) \times 2.0$$
$$\text{scale}_x = \frac{W}{W_{\text{canvas}}}, \quad \text{scale}_y = \frac{H}{H_{\text{canvas}}}$$

Because the GPU viewport is sized to match the physical aspect ratio of the sequence, the composited output maps to the display surface with zero geometric distortion.

---

## 8. Summary of Engineering Invariants

| ID | Invariant | Enforcement Mechanism |
|---|---|---|
| **INV-DIM-1** | Canvas is Master Coordinate Space | All clips, overlays, and keyframes store positions in $[0..W_c, 0..H_c]$. |
| **INV-DIM-2** | Keyframe Dominance Over Conform | Evaluator evaluates keyframes first; conform supplies baseline for un-keyframed properties. |
| **INV-DIM-3** | Aspect Ratio Locking Across Quality Tiers | `PreviewQualityManager` locks $\text{maxHeight} = \text{round}(\text{maxWidth} \times \frac{H_c}{W_c})$. |
| **INV-DIM-4** | Dual-Model Refit on Aspect Change | `refitClipsForCanvasChange` updates both cached `{x, y, w, h}` and `clip.conform` with scaled offsets. |
| **INV-DIM-5** | High-DPI Physical Pixel Mapping | Native surface dimensions use `Math.round(displayDim * DPR)` to avoid subpixel blur. |
