/**
 * RasterSurface
 *
 * Canvas2D renderer for RenderArtifacts.
 *
 * Core invariant: pixels drawn are ALWAYS from a pre-scaled ImageBitmap
 * produced by the backend pyramid. No browser-side resampling. Ever.
 *
 * The surface receives TransportArtifacts (ImageBitmap + exact pixel dims)
 * and draws them into a canvas that is sized to match the display layout.
 * `drawImage(bitmap, ...)` goes through the GPU compositor — not CSS scaling.
 *
 * Usage:
 *   const surface = new RasterSurface(canvasEl);
 *   surface.drawFilmstrip(artifacts, clipWidthPx, stripHeightPx);
 *   // On unmount:
 *   surface.dispose();
 */

import type { TransportArtifact } from "./transport";
import { getFilmstripTileSlots } from "../filmstrip/filmstripLayout";
import type { FilmstripTileAddress } from "../filmstrip/filmstripTiers";
import type { FilmstripTileCache } from "../filmstrip/FilmstripTileCache";
import { SpatialTier } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FilmstripLayout = {
  /** Logical clip width in CSS pixels */
  clipWidthPx: number;
  /** Strip height in CSS pixels */
  stripHeightPx: number;
  /** Device pixel ratio — used to size the canvas backing store */
  dpr: number;
  /** Target tile width in CSS pixels (default 60) */
  tileWidthPx?: number;
  /** Start time of clip trimming boundary in seconds */
  trimIn?: number;
  /** End time of clip trimming boundary in seconds */
  trimOut?: number;
  /** Exact source-time address for every render slot. */
  tileAddresses?: readonly FilmstripTileAddress[];
  /**
   * Optional tile cache for coarse-to-dense pyramid fallback.
   * When a dense (L1/L2/L3) tile is absent, the renderer will look up the
   * L0 coarse tile at the same timestamp and stretch it to fill the slot.
   * Eliminates shimmer during zoom transitions — blurry-but-instant is better
   * than empty while dense tiles are in-flight.
   */
  tileCache?: FilmstripTileCache;
  /** Clip ID — required when tileCache is provided for fallback lookups. */
  clipId?: string;
  /** Video path — used for cross-clip content hash deduplication lookups. */
  videoPath?: string;
  /** Timeline pixels per second zoom factor */
  pixelsPerSecond?: number;
  /** Offset inside the full clip where the bounded render surface is positioned */
  renderWindowLeftPx?: number;
  /** Unbounded trimIn of the full clip in seconds */
  clipTrimIn?: number;
};

// ─── RasterSurface ────────────────────────────────────────────────────────────

export class RasterSurface {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D | null;
  private _disposed = false;

  /** Open bitmaps owned by this surface — closed on dispose() */
  private _ownedBitmaps: Set<ImageBitmap> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d", {
      alpha: false, // opaque — no premul alpha overhead
      desynchronized: true, // hint: don't wait for vsync for offscreen paint
    });
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  private _applyLayout(layout: FilmstripLayout): void {
    const { clipWidthPx, stripHeightPx, dpr } = layout;
    const backingW = Math.round(clipWidthPx * dpr);
    const backingH = Math.round(stripHeightPx * dpr);

    if (this._canvas.width !== backingW || this._canvas.height !== backingH) {
      this._canvas.width = backingW;
      this._canvas.height = backingH;
      // Reset CSS size to logical pixels (canvas sizing clears it)
      this._canvas.style.width = `${clipWidthPx}px`;
      this._canvas.style.height = `${stripHeightPx}px`;
    }
  }

  // ── Filmstrip Render ─────────────────────────────────────────────────────────

  /**
   * Draw a filmstrip from an ordered array of TransportArtifacts.
   *
   * Artifacts should be sorted by timestamp (ascending).
   * Tile count is driven by clipWidthPx / tileWidthPx — never by artifact count.
   * When tileAddresses are supplied, every slot is matched by its exact
   * source timestamp. Missing slots remain background.
   *
   * Filmstrip frames are drawn in physical backing-store pixels. Tile slots are
   * fixed width, and native bitmaps are clipped into those slots without passing
   * destination width/height to drawImage().
   */
  drawFilmstrip(artifacts: readonly TransportArtifact[], layout: FilmstripLayout): void {
    if (this._disposed || !this._ctx) return;

    this._applyLayout(layout);

    const ctx = this._ctx;
    const { clipWidthPx, stripHeightPx, dpr, tileWidthPx: targetTileW = 60 } = layout;

    const backingW = this._canvas.width;
    const backingH = this._canvas.height;

    // Clear with background
    ctx.fillStyle = "#0c2730";
    ctx.fillRect(0, 0, backingW, backingH);

    if (layout.tileAddresses && layout.trimIn !== undefined && layout.trimOut !== undefined) {
      const artifactByTimestamp = new Map<number, TransportArtifact>();
      for (const artifact of artifacts) {
        if (!artifact.bitmap || artifact.bitmap.width === 0 || artifact.bitmap.height === 0) continue;
        artifactByTimestamp.set(Math.round(artifact.timestampMs), artifact);
      }

      const slots = getFilmstripTileSlots({
        addresses: layout.tileAddresses,
        clipWidthPx,
        trimIn: layout.trimIn,
        trimOut: layout.trimOut,
        tileWidthPx: targetTileW,
        pixelsPerSecond: layout.pixelsPerSecond,
        renderWindowLeftPx: layout.renderWindowLeftPx,
        clipTrimIn: layout.clipTrimIn,
      });

      let exactCount = 0;
      let fallbackCount = 0;
      let pendingCount = 0;

      for (const slot of slots) {
        const artifact = artifactByTimestamp.get(Math.round(slot.address.timestamp * 1000));
        const slotX = Math.round(slot.leftPx * dpr);
        const slotW = Math.max(1, Math.round(slot.widthPx * dpr));
        const slotH = Math.max(1, Math.round(stripHeightPx * dpr));

        if (artifact) {
          exactCount++;
          this._drawTile(
            ctx,
            artifact.bitmap,
            artifact.width,
            artifact.height,
            slotX,
            0,
            slotW,
            slotH,
          );
        } else if (layout.tileCache && (layout.clipId || layout.videoPath) && slot.address.zoomTier !== SpatialTier.L0) {
          // Multi-tier pyramid fallback: look up best available lower-tier tile (L2 -> L1 -> L0)
          // and stretch it — blurry-but-instant is better than shimmer during zoom transitions.
          const fallbackEntry = layout.tileCache.findBestFallback(
            layout.clipId ?? "",
            slot.address.zoomTier,
            slot.address.timestamp,
            layout.videoPath,
            /* tolerance: */ 6.0,
            slot.address.effectGraphVersion,
          );
          if (fallbackEntry && fallbackEntry.artifact.bitmap && fallbackEntry.artifact.bitmap.width > 0) {
            fallbackCount++;
            // Draw with imageSmoothingEnabled to produce a smooth bicubic stretch
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium";
            this._drawTile(
              ctx,
              fallbackEntry.artifact.bitmap,
              fallbackEntry.artifact.width,
              fallbackEntry.artifact.height,
              slotX,
              0,
              slotW,
              slotH,
            );
            ctx.restore();
          } else {
            pendingCount++;
            this._drawPendingSlotPlaceholder(ctx, slotX, 0, slotW, slotH);
          }
        } else {
          pendingCount++;
          this._drawPendingSlotPlaceholder(ctx, slotX, 0, slotW, slotH);
        }
      }

      this._drawEdgeFade(ctx, backingW, backingH);
      return;
    }

    // Legacy callers without exact addresses still use deterministic slots,
    // but never substitute or repeat a nearest artifact.
    const tileCount = Math.max(1, Math.ceil(clipWidthPx / targetTileW));
    const tileW = Math.round(targetTileW * dpr);
    const tileH = Math.round(stripHeightPx * dpr);

    for (let i = 0; i < tileCount; i++) {
      const art = artifacts[i];

      // DEFENSIVE: Skip this tile if the selected artifact is invalid
      if (!art?.bitmap || art.bitmap.width === 0 || art.bitmap.height === 0) {
        continue;
      }

      const x = i * tileW;

      this._drawTile(ctx, art.bitmap, art.width, art.height, x, 0, tileW, tileH);
    }

    // Overlay: subtle gradient at left/right edges to soften tile boundaries
    this._drawEdgeFade(ctx, backingW, backingH);
  }

  /**
   * Draw a single tile by center-cropping the bitmap to fill the tile completely.
   * Scales to cover, then clips to tile boundaries - no gaps, no letterboxing.
   */
  private _drawTile(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, bmpW: number, bmpH: number, x: number, y: number, tileW: number, tileH: number): void {
    if (bmpW === 0 || bmpH === 0 || tileW === 0 || tileH === 0) return;

    // DEFENSIVE: Check if bitmap is valid before attempting to draw
    if (!bitmap || bitmap.width === 0 || bitmap.height === 0) {
      return;
    }

    // Center-crop: scale bitmap to cover tile, then crop to fit
    const bmpAspect = bmpW / bmpH;
    const tileAspect = tileW / tileH;

    let drawW: number, drawH: number, drawX: number, drawY: number;

    if (bmpAspect > tileAspect) {
      // Bitmap is wider - fit height, crop width
      drawH = tileH;
      drawW = Math.round(drawH * bmpAspect);
      drawX = Math.round(x - (drawW - tileW) / 2);
      drawY = y;
    } else {
      // Bitmap is taller - fit width, crop height
      drawW = tileW;
      drawH = Math.round(drawW / bmpAspect);
      drawX = x;
      drawY = Math.round(y + (tileH - drawH) / 2);
    }

    try {
      ctx.save();
      ctx.beginPath();
      ctx.rect(Math.round(x), Math.round(y), Math.round(tileW), Math.round(tileH));
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
      ctx.restore();
    } catch (e) {
      // Bitmap was closed between the check and draw - skip silently
      ctx.restore();
    }
  }

  /** Draw a single poster frame filling the entire strip. */
  drawPoster(bitmap: ImageBitmap, layout: FilmstripLayout): void {
    if (this._disposed || !this._ctx) return;
    this._applyLayout(layout);

    const ctx = this._ctx;
    const { clipWidthPx, stripHeightPx, dpr } = layout;

    this._drawTile(ctx, bitmap, bitmap.width, bitmap.height, 0, 0, Math.round(clipWidthPx * dpr), Math.round(stripHeightPx * dpr));
  }

  /** Draw a placeholder (waiting for decode). */
  drawPlaceholder(layout: FilmstripLayout): void {
    if (this._disposed || !this._ctx) return;
    this._applyLayout(layout);
    this._clear(layout);
  }

  // ── Edge Fade ────────────────────────────────────────────────────────────────

  private _drawEdgeFade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const fadeW = Math.min(6, w * 0.05);

    const left = ctx.createLinearGradient(0, 0, fadeW, 0);
    left.addColorStop(0, "rgba(0,0,0,0.35)");
    left.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, fadeW, h);

    const right = ctx.createLinearGradient(w - fadeW, 0, w, 0);
    right.addColorStop(0, "rgba(0,0,0,0)");
    right.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = right;
    ctx.fillRect(w - fadeW, 0, fadeW, h);
  }

  private _drawPendingSlotPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save();
    // Subtle background tint
    ctx.fillStyle = "rgba(18, 54, 66, 0.35)";
    ctx.fillRect(x, y, w, h);

    // Subtle tile separator line on left boundary
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fillRect(x, y, 1, h);

    // Diagonal subtle shimmer hatch lines to indicate actively indexing footage
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let offset = -h; offset < w; offset += 16) {
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset + h, y + h);
    }
    ctx.stroke();
    ctx.restore();
  }

  private _clear(layout: FilmstripLayout): void {
    if (!this._ctx) return;
    this._applyLayout(layout);
    this._ctx.fillStyle = "#0c2730";
    this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
  }

  // ── Bitmap Ownership ─────────────────────────────────────────────────────────

  /**
   * Take ownership of a bitmap — it will be closed when `dispose()` is called.
   * Only call this for bitmaps the caller doesn't intend to reuse.
   */
  own(bitmap: ImageBitmap): void {
    this._ownedBitmaps.add(bitmap);
  }

  /** Release ownership of a bitmap (caller takes back responsibility). */
  release(bitmap: ImageBitmap): void {
    this._ownedBitmaps.delete(bitmap);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const bmp of this._ownedBitmaps) bmp.close();
    this._ownedBitmaps.clear();
    this._ctx = null;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}
