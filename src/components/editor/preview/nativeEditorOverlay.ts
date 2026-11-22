import type { Clip } from "@/types";
import type { NativeRasterLayerSnapshot } from "@/lib/platform/nativeCore";
import type { ActiveSnapGuides } from "@/core/interactions";
import {
  registerNativeRasterAsset,
  unregisterNativeRasterAsset,
  isTauriRuntime,
} from "@/lib/platform/tauri";
import { isClipActiveAtTime } from "@/lib/timeline/timelineClip";
import { resolveClipVisualBounds } from "@/lib/transform/transformUtils";

export interface NativeEditorOverlayParams {
  canvasWidth: number;
  canvasHeight: number;
  previewScale?: number;
  selectedClips: Clip[];
  safeOverlayVisible: boolean;
  activeGuides?: ActiveSnapGuides | null;
  frameIndex?: number;
  currentTime?: number;
}

/**
 * Checks if activeGuides contains any visible snap line or rotation indicator.
 */
export function hasVisibleGuides(
  guides?: ActiveSnapGuides | null,
): boolean {
  if (!guides) return false;
  return Boolean(
    guides.snappedX ||
      guides.snappedY ||
      guides.snappedLeft ||
      guides.snappedRight ||
      guides.snappedTop ||
      guides.snappedBottom ||
      guides.snapGuideX != null ||
      guides.snapGuideY != null ||
      guides.rotationDegrees != null,
  );
}

/**
 * Rasterizes interactive editor overlays (selection boxes, transform handles,
 * rotation controls, safe margins, and horizontal/vertical alignment guides)
 * as a native GPU raster layer.
 *
 * This allows paused preview frames, seeks, scrubs, and interactive dragging
 * to present directly on the native surface GPU backbuffer without dropping
 * to CPU-RGBA bridge readback.
 *
 * Hit-testing falls through the native window to the DOM handles underneath,
 * preserving existing pointer interactions (drag, resize, rotate).
 */
export function rasterizeNativeEditorOverlay(
  params: NativeEditorOverlayParams,
): NativeRasterLayerSnapshot | null {
  const {
    canvasWidth,
    canvasHeight,
    previewScale = 1,
    selectedClips,
    safeOverlayVisible,
    activeGuides,
    currentTime,
  } = params;

  if (canvasWidth <= 0 || canvasHeight <= 0) return null;
  const activeSelectedClips =
    currentTime !== undefined
      ? selectedClips.filter((c) => isClipActiveAtTime(c, currentTime))
      : selectedClips;
  const guidesVisible = hasVisibleGuides(activeGuides);
  if (activeSelectedClips.length === 0 && !safeOverlayVisible && !guidesVisible) {
    return null;
  }

  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const invScale = 1 / Math.max(0.01, previewScale);

  // 1. Draw Safe Areas if visible
  if (safeOverlayVisible) {
    ctx.save();

    // 90% Action Safe
    const actionW = canvasWidth * 0.9;
    const actionH = canvasHeight * 0.9;
    const actionX = (canvasWidth - actionW) / 2;
    const actionY = (canvasHeight - actionH) / 2;
    if (typeof ctx.setLineDash === "function") {
      ctx.setLineDash([8 * invScale, 8 * invScale]);
    }
    ctx.strokeStyle = "rgba(34, 211, 238, 0.55)"; // cyan-400
    ctx.lineWidth = Math.max(1, 1.5 * invScale);
    ctx.strokeRect(actionX, actionY, actionW, actionH);

    // 80% Title Safe
    const titleW = canvasWidth * 0.8;
    const titleH = canvasHeight * 0.8;
    const titleX = (canvasWidth - titleW) / 2;
    const titleY = (canvasHeight - titleH) / 2;
    ctx.strokeStyle = "rgba(129, 140, 248, 0.55)"; // indigo-400
    ctx.strokeRect(titleX, titleY, titleW, titleH);

    // Center Crosshair Marker
    const crosshairLen = Math.max(8, 12 * invScale);
    if (typeof ctx.setLineDash === "function") {
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = Math.max(1, 1 * invScale);
    ctx.beginPath();
    ctx.moveTo(canvasWidth / 2 - crosshairLen, canvasHeight / 2);
    ctx.lineTo(canvasWidth / 2 + crosshairLen, canvasHeight / 2);
    ctx.moveTo(canvasWidth / 2, canvasHeight / 2 - crosshairLen);
    ctx.lineTo(canvasWidth / 2, canvasHeight / 2 + crosshairLen);
    ctx.stroke();

    ctx.restore();
  }

  // 2. Draw Horizontal & Vertical Snap Alignment Guides
  if (guidesVisible && activeGuides) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, 1 * invScale);
    ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
    ctx.shadowBlur = Math.max(2, 4 * invScale);

    // Canvas Center Vertical Guide (snappedX)
    if (activeGuides.snappedX) {
      const centerX = Math.round(canvasWidth / 2);
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, canvasHeight);
      ctx.stroke();
    }

    // Canvas Center Horizontal Guide (snappedY)
    if (activeGuides.snappedY) {
      const centerY = Math.round(canvasHeight / 2);
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvasWidth, centerY);
      ctx.stroke();
    }

    // Canvas Left Alignment Guide
    if (activeGuides.snappedLeft) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, canvasHeight);
      ctx.stroke();
    }

    // Canvas Right Alignment Guide
    if (activeGuides.snappedRight) {
      ctx.beginPath();
      ctx.moveTo(canvasWidth, 0);
      ctx.lineTo(canvasWidth, canvasHeight);
      ctx.stroke();
    }

    // Canvas Top Alignment Guide
    if (activeGuides.snappedTop) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(canvasWidth, 0);
      ctx.stroke();
    }

    // Canvas Bottom Alignment Guide
    if (activeGuides.snappedBottom) {
      ctx.beginPath();
      ctx.moveTo(0, canvasHeight);
      ctx.lineTo(canvasWidth, canvasHeight);
      ctx.stroke();
    }

    // General Vertical Snap Guide (e.g. clip-to-clip)
    if (
      typeof activeGuides.snapGuideX === "number" &&
      !activeGuides.snappedX &&
      !activeGuides.snappedLeft &&
      !activeGuides.snappedRight
    ) {
      const gx = Math.round(activeGuides.snapGuideX);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, canvasHeight);
      ctx.stroke();
    }

    // General Horizontal Snap Guide (e.g. clip-to-clip)
    if (
      typeof activeGuides.snapGuideY === "number" &&
      !activeGuides.snappedY &&
      !activeGuides.snappedTop &&
      !activeGuides.snappedBottom
    ) {
      const gy = Math.round(activeGuides.snapGuideY);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(canvasWidth, gy);
      ctx.stroke();
    }

    ctx.restore();

    // Rotation Degree Indicator (e.g. "45°")
    if (typeof activeGuides.rotationDegrees === "number") {
      ctx.save();
      const badgeW = 56 * invScale;
      const badgeH = 26 * invScale;
      const badgeX = (canvasWidth - badgeW) / 2;
      const badgeY = 24 * invScale;
      const badgeRadius = 4 * invScale;

      ctx.save();
      ctx.fillStyle = "rgba(24, 24, 27, 0.85)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = Math.max(3, 6 * invScale);
      ctx.shadowOffsetY = Math.max(1, 2 * invScale);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeRadius);
      } else {
        ctx.rect(badgeX, badgeY, badgeW, badgeH);
      }
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#ffffff";
      ctx.font = `600 ${Math.max(10, 13 * invScale)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${activeGuides.rotationDegrees}°`,
        canvasWidth / 2,
        badgeY + badgeH / 2,
      );

      ctx.restore();
    }
  }

  // 3. Draw Transform Controls for Selected Clips (matching TransformOverlay.tsx styling)
  for (const clip of activeSelectedClips) {
    const visualBounds = resolveClipVisualBounds(
      clip,
      canvasWidth,
      canvasHeight,
      "native-surface",
      currentTime,
    );
    const clipW = visualBounds.width || clip.width || canvasWidth;
    const clipH = visualBounds.height || clip.height || canvasHeight;
    const clipX = visualBounds.x ?? clip.x ?? (canvasWidth - clipW) / 2;
    const clipY = visualBounds.y ?? clip.y ?? (canvasHeight - clipH) / 2;
    const rotation = clip.rotation || 0;

    const centerX = clipX + clipW / 2;
    const centerY = clipY + clipH / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }

    const halfW = clipW / 2;
    const halfH = clipH / 2;

    // Selection Bounding Box: 1px crisp white border with subtle shadow
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = Math.max(2, 4 * invScale);
    ctx.shadowOffsetY = Math.max(1, 2 * invScale);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, 1.25 * invScale);
    ctx.strokeRect(-halfW, -halfH, clipW, clipH);
    ctx.restore();

    // 4 Corner Handles: 10px screen diameter, white dot, subtle dark stroke, shadow
    const cornerRadius = 5 * invScale;
    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [-halfW, halfH],
      [halfW, halfH],
    ];
    for (const [cx, cy] of corners) {
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = Math.max(2, 4 * invScale);
      ctx.shadowOffsetY = Math.max(1, 2 * invScale);
      ctx.beginPath();
      ctx.arc(cx, cy, cornerRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, cornerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
      ctx.lineWidth = Math.max(1, 1 * invScale);
      ctx.stroke();
    }

    ctx.restore();
  }

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const clipSummary = selectedClips
    .map(
      (c) =>
        `${c.id}:${c.x}:${c.y}:${c.width}:${c.height}:${c.rotation}:${c.startTime}:${c.duration}`,
    )
    .join(",");
  const guideSummary = activeGuides
    ? `${Boolean(activeGuides.snappedX)}:${Boolean(activeGuides.snappedY)}:${Boolean(activeGuides.snappedLeft)}:${Boolean(activeGuides.snappedRight)}:${Boolean(activeGuides.snappedTop)}:${Boolean(activeGuides.snappedBottom)}:${activeGuides.snapGuideX ?? ""}:${activeGuides.snapGuideY ?? ""}:${activeGuides.rotationDegrees ?? ""}`
    : "no-guides";
  const assetId = `native-editor-overlay:${canvasWidth}x${canvasHeight}:${safeOverlayVisible}:${guideSummary}:${clipSummary}`;

  return {
    layerId: "native-editor-overlay",
    assetId,
    rgba: imageData.data,
    width: canvasWidth,
    height: canvasHeight,
    displayWidth: canvasWidth,
    displayHeight: canvasHeight,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    zIndex: 10000,
    blendMode: "normal",
  };
}

export interface NativeEditorOverlayManagerConfig {
  registerRasterAsset: (
    asset: NativeRasterLayerSnapshot & {
      rgba: Uint8ClampedArray | number[];
    },
  ) => Promise<void>;
  unregisterRasterAsset: (assetId: string) => Promise<void>;
  isTauriRuntime: () => boolean;
}

/**
 * Manages the GPU texture cache lifecycle and registration for interactive
 * native editor overlays.
 *
 * Enforces strict registration ordering: an overlay snapshot is returned to
 * the frame demand only after Rust has confirmed texture residency.
 */
export class NativeEditorOverlayManager {
  private currentAssetId: string | null = null;
  private currentSignature: string | null = null;
  private currentSnapshot: NativeRasterLayerSnapshot | null = null;
  private pendingUnregisterIds: string[] = [];
  private lastUploadDurationMs = 0;
  private lastRasterizeDurationMs = 0;

  constructor(
    private readonly config: NativeEditorOverlayManagerConfig = {
      registerRasterAsset: registerNativeRasterAsset,
      unregisterRasterAsset: unregisterNativeRasterAsset,
      isTauriRuntime: isTauriRuntime,
    },
  ) {}

  public getLastUploadDurationMs(): number {
    return this.lastUploadDurationMs;
  }

  public getLastRasterizeDurationMs(): number {
    return this.lastRasterizeDurationMs;
  }

  public hasActiveOverlay(): boolean {
    return this.currentSnapshot !== null;
  }

  public getCurrentAssetId(): string | null {
    return this.currentAssetId;
  }

  public async getOrRegisterOverlay(
    params: NativeEditorOverlayParams,
  ): Promise<NativeRasterLayerSnapshot | null> {
    if (!this.config.isTauriRuntime()) {
      return null;
    }

    const {
      canvasWidth,
      canvasHeight,
      selectedClips,
      safeOverlayVisible,
      activeGuides,
    } = params;
    if (canvasWidth <= 0 || canvasHeight <= 0) return null;
    const guidesVisible = hasVisibleGuides(activeGuides);
    if (selectedClips.length === 0 && !safeOverlayVisible && !guidesVisible) {
      await this.cleanupLingeringAssets();
      return null;
    }

    const signature = this.computeSignature(params);
    if (signature === this.currentSignature && this.currentSnapshot) {
      return this.currentSnapshot;
    }

    const t0 = performance.now();
    const raster = rasterizeNativeEditorOverlay(params);
    const t1 = performance.now();
    this.lastRasterizeDurationMs = t1 - t0;
    if (!raster || !raster.rgba) {
      return null;
    }

    const tUploadStart = performance.now();
    try {
      await this.config.registerRasterAsset(
        raster as NativeRasterLayerSnapshot & { rgba: Uint8ClampedArray },
      );
      const tUploadEnd = performance.now();
      this.lastUploadDurationMs = tUploadEnd - tUploadStart;

      if (this.currentAssetId && this.currentAssetId !== raster.assetId) {
        this.pendingUnregisterIds.push(this.currentAssetId);
      }

      this.currentAssetId = raster.assetId;
      this.currentSignature = signature;
      // Discard raw rgba in JS heap; pass metadata snapshot to frame demand
      this.currentSnapshot = {
        ...raster,
        rgba: undefined,
      };

      await this.flushPendingEvictions();
      return this.currentSnapshot;
    } catch (err) {
      console.warn("[NativeEditorOverlay] Asset registration failed:", err);
      return null;
    }
  }

  public async cleanupLingeringAssets(): Promise<void> {
    if (this.currentAssetId) {
      this.pendingUnregisterIds.push(this.currentAssetId);
      this.currentAssetId = null;
      this.currentSignature = null;
      this.currentSnapshot = null;
    }
    await this.flushPendingEvictions();
  }

  private async flushPendingEvictions(): Promise<void> {
    const toEvict = [...this.pendingUnregisterIds];
    this.pendingUnregisterIds = [];
    for (const assetId of toEvict) {
      try {
        await this.config.unregisterRasterAsset(assetId);
      } catch {
        // Ignored if already evicted
      }
    }
  }

  private computeSignature(params: NativeEditorOverlayParams): string {
    const {
      canvasWidth,
      canvasHeight,
      previewScale = 1,
      safeOverlayVisible,
      selectedClips,
      activeGuides,
      currentTime,
    } = params;
    const activeClips =
      currentTime !== undefined
        ? selectedClips.filter((c) => isClipActiveAtTime(c, currentTime))
        : selectedClips;
    const clipSummary = activeClips
      .map(
        (c) =>
          `${c.id}:${c.x}:${c.y}:${c.width}:${c.height}:${c.rotation}:${c.startTime}:${c.duration}`,
      )
      .join(";");
    const guideSummary = activeGuides
      ? `${Boolean(activeGuides.snappedX)}:${Boolean(activeGuides.snappedY)}:${Boolean(activeGuides.snappedLeft)}:${Boolean(activeGuides.snappedRight)}:${Boolean(activeGuides.snappedTop)}:${Boolean(activeGuides.snappedBottom)}:${activeGuides.snapGuideX ?? ""}:${activeGuides.snapGuideY ?? ""}:${activeGuides.rotationDegrees ?? ""}`
      : "no-guides";
    return `${canvasWidth}x${canvasHeight}:${previewScale.toFixed(3)}:${safeOverlayVisible}:${guideSummary}:${currentTime ?? 0}:${clipSummary}`;
  }
}
