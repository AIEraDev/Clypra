/**
 * Coordinate System for Timeline Engine v1
 * Provides bidirectional time ↔ pixel conversion with zoom support
 */

import { clamp } from "./math";

export class CoordinateSystem {
  private static readonly MIN_ZOOM = 16; // pixels per second
  private static readonly MAX_ZOOM = 320; // pixels per second

  constructor(private pxPerSec: number) {
    this.pxPerSec = clamp(pxPerSec, CoordinateSystem.MIN_ZOOM, CoordinateSystem.MAX_ZOOM);
  }

  /**
   * Converts time in seconds to horizontal pixel position
   */
  timeToPixels(time: number): number {
    return time * this.pxPerSec;
  }

  /**
   * Converts horizontal pixel position to time in seconds
   */
  pixelsToTime(pixels: number): number {
    return pixels / this.pxPerSec;
  }

  /**
   * Zooms while keeping the time under the cursor stable
   *
   * @param cursorX - Cursor X position relative to viewport
   * @param scrollLeft - Current horizontal scroll position
   * @param zoomFactor - Multiplier for zoom (e.g., 1.2 for zoom in, 0.8 for zoom out)
   * @param minZoom - Minimum allowed zoom level (default: 16)
   * @param maxZoom - Maximum allowed zoom level (default: 320)
   * @returns New zoom level and scroll position
   */
  zoomToCursor(cursorX: number, scrollLeft: number, zoomFactor: number, minZoom: number = CoordinateSystem.MIN_ZOOM, maxZoom: number = CoordinateSystem.MAX_ZOOM): { newPxPerSec: number; newScrollLeft: number } {
    // Calculate the time value under the cursor
    const timeUnderCursor = this.pixelsToTime(scrollLeft + cursorX);

    // Calculate new zoom level with constraints
    const newPxPerSec = clamp(this.pxPerSec * zoomFactor, minZoom, maxZoom);

    // Calculate new scroll position to keep time under cursor stable
    const newScrollLeft = timeUnderCursor * newPxPerSec - cursorX;

    return {
      newPxPerSec,
      newScrollLeft: Math.max(0, newScrollLeft),
    };
  }

  /**
   * Quantizes time to the nearest frame boundary
   *
   * @param time - Time in seconds
   * @param fps - Frame rate (24, 25, 30, 50, or 60)
   * @returns Time rounded to nearest frame boundary
   */
  quantizeToFrame(time: number, fps: number): number {
    const frameNumber = Math.round(time * fps);
    return frameNumber / fps;
  }

  /**
   * Calculates the major tick interval for the time ruler based on current zoom
   *
   * @returns Interval in seconds for major tick marks
   */
  calculateMajorTickInterval(): number {
    if (this.pxPerSec >= 100) return 1;
    if (this.pxPerSec >= 48) return 2;
    if (this.pxPerSec >= 24) return 5;
    return 10;
  }

  /**
   * Gets the current zoom level in pixels per second
   */
  getPxPerSec(): number {
    return this.pxPerSec;
  }

  /**
   * Sets a new zoom level with constraints
   */
  setPxPerSec(pxPerSec: number): void {
    this.pxPerSec = clamp(pxPerSec, CoordinateSystem.MIN_ZOOM, CoordinateSystem.MAX_ZOOM);
  }
}
