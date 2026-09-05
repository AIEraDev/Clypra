/**
 * Transform Controller - Imperative Transform State Management
 *
 * ARCHITECTURE: Signal Plane
 * - Transform state updates at 60fps during drag (>4Hz)
 * - RAF loop reads imperatively (no React re-renders)
 * - Only commits to Zustand on mouseup (discrete user action)
 *
 * This is NOT React state. This is an imperative transform engine.
 *
 * Key principles:
 * - Transform is a continuous signal during drag, not discrete state
 * - Consumers read imperatively via getActiveTransform()
 * - No React re-renders on every mouse move
 * - High-frequency updates (60fps) without React overhead
 *
 * Architecture:
 *   TransformController (signal source)
 *       ↓
 *   Imperative consumers (overlay render, TransformPreviewLayer)
 *       ↓
 *   Commit to timeline store (on mouseup ONLY — never during drag)
 *
 * This prevents:
 * - React render storms during drag
 * - Transform lag (mousemove → setState → re-render → overlay update)
 * - Effect cancellation loops
 * - Tauri IPC saturation (no updateClip mid-drag)
 */

import type { TransformState, TransformHandle } from "@/types";

export type TransformListener = (state: TransformState | null) => void;

/**
 * The live geometry of a clip as computed during a drag.
 * All values are in canvas space.
 */
export interface DragGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Text clips only. Undefined for non-text clips. */
  fontSize?: number;
  /** Conform state for clips with aspect-ratio conformation. */
  conform?: Record<string, unknown>;
  /** Visual canvas position for display overlays when clip coordinates differ from visual bounds (e.g. templates) */
  visualX?: number;
  visualY?: number;
}

/**
 * Callback type for fast-path drag subscribers.
 * Receives the latest computed geometry each RAF, enabling CSS matrix preview
 * without touching React state or the Zustand store.
 */
export type DragGeometryListener = (
  geometry: DragGeometry,
  sessionId: number,
  revision: number,
) => void;

export type DragEndListener = (
  sessionId: number,
  finalGeometry: DragGeometry,
) => void;

/**
 * Transform Controller - Imperative transform state.
 *
 * This is the SINGLE SOURCE OF TRUTH for active transform operations.
 * It is NOT React state. It is a continuous signal during drag.
 *
 * --- Two-Speed Architecture Contract ---
 * During an active drag:
 *   1. TransformOverlay calls updateDragGeometry() on every RAF — no store writes.
 *   2. TransformPreviewLayer (and any other subscriber) receives the geometry
 *      synchronously and applies a CSS matrix preview at 60Hz+.
 *   3. On mouseup, TransformOverlay reads getFinalDragGeometry() and commits
 *      a single TransformClipCommand to the historyStore (which writes to the
 *      Zustand store with epoch increment).
 *
 * Net result: 0 Zustand writes, 0 React re-renders, 0 IPC dispatches during drag.
 */
export class TransformController {
  private _activeTransform: TransformState | null = null;

  // --- Drag session tracking (Two-Speed Architecture) ---
  private _dragSessionId: number = 0;
  private _dragRevision: number = 0;
  private _currentDragGeometry: DragGeometry | null = null;

  // Listeners for drag geometry (fast-path, called every RAF)
  private _dragGeometryListeners = new Set<DragGeometryListener>();
  // Listeners for drag end (called once on mouseup)
  private _dragEndListeners = new Set<DragEndListener>();

  // Legacy listeners (for UI snapshots only, throttled to 10fps)
  private _listeners = new Set<TransformListener>();
  private _lastNotifyTime: number = 0;
  private _notifyThrottleMs: number = 100;

  constructor() {
    this.startTransform = this.startTransform.bind(this);
    this.updateTransform = this.updateTransform.bind(this);
    this.endTransform = this.endTransform.bind(this);
  }

  // ─── Getters (Imperative reads) ────────────────────────────────────────────

  /**
   * Get active transform (imperative read).
   * This is how consumers should read transform - NOT via React state.
   */
  getActiveTransform(): TransformState | null {
    return this._activeTransform;
  }

  /**
   * Get current drag session ID.
   * Increments on every new pointerdown (startTransform call).
   * Used by TransformPreviewLayer to discard stale authoritative frames.
   */
  getDragSessionId(): number {
    return this._dragSessionId;
  }

  /**
   * Get current drag revision.
   * Increments on every updateDragGeometry call within a session.
   * Used for stale-frame rejection in the native readback path.
   */
  getDragRevision(): number {
    return this._dragRevision;
  }

  /**
   * Get current drag geometry (imperative read).
   * Returns the most recent geometry computed by applyMouseMove.
   * Null when no drag is active.
   */
  getCurrentDragGeometry(): DragGeometry | null {
    return this._currentDragGeometry;
  }

  /**
   * Whether a drag is currently active.
   */
  isDragging(): boolean {
    return this._activeTransform !== null;
  }

  /**
   * Get transform mode.
   */
  getTransformMode(): "select" | "transform" | null {
    return this._activeTransform ? "transform" : null;
  }

  // ─── Transform Control ─────────────────────────────────────────────────────

  /**
   * Start transform operation (called on pointerdown).
   * Increments dragSessionId, resets dragRevision, and captures the
   * baseline geometry from the clip's current state.
   */
  startTransform(state: TransformState): void {
    this._activeTransform = state;
    this._dragSessionId += 1;
    this._dragRevision = 0;
    // Seed currentDragGeometry from start transform so preview layer can render
    // immediately before the first mousemove arrives.
    this._currentDragGeometry = {
      x: state.startTransform.x,
      y: state.startTransform.y,
      width: state.startTransform.width,
      height: state.startTransform.height,
      rotation: state.startTransform.rotation ?? 0,
      conform: state.startTransform.conform,
    };
    this._notifyListeners();
  }

  /**
   * Update transform during drag (called every RAF by applyMouseMove).
   * This runs at 60fps and does NOT notify legacy listeners (no React re-renders).
   * Fast-path subscribers (TransformPreviewLayer) receive the geometry synchronously.
   *
   * NOTE: No Zustand store writes happen here. The store is written ONLY on mouseup.
   */
  updateTransform(state: TransformState): void {
    this._activeTransform = state;
    // No legacy notification during drag
  }

  /**
   * Publish new drag geometry to fast-path subscribers.
   * Called by TransformOverlay.applyMouseMove after calculateTransform.
   *
   * This is the core of the Two-Speed architecture: the preview layer receives
   * the geometry here and renders a CSS matrix preview without any React state
   * mutation, Zustand write, or IPC call.
   */
  updateDragGeometry(geometry: DragGeometry): void {
    if (!this._activeTransform) return;
    this._dragRevision += 1;
    this._currentDragGeometry = geometry;
    const sessionId = this._dragSessionId;
    const revision = this._dragRevision;
    // Synchronous notify — runs in the same RAF as the caller
    this._dragGeometryListeners.forEach((listener) => {
      listener(geometry, sessionId, revision);
    });
  }

  /**
   * End transform operation (called on mouseup).
   * Notifies drag-end subscribers with the final geometry, clears active state.
   */
  endTransform(): void {
    const finalGeometry = this._currentDragGeometry;
    const sessionId = this._dragSessionId;
    this._activeTransform = null;
    this._currentDragGeometry = null;
    if (finalGeometry) {
      this._dragEndListeners.forEach((listener) => {
        listener(sessionId, finalGeometry);
      });
    }
    this._notifyListeners();
  }

  // ─── Fast-Path Subscriptions (For TransformPreviewLayer) ───────────────────

  /**
   * Subscribe to drag geometry updates (fast-path, every RAF).
   * Used by TransformPreviewLayer to apply CSS matrix preview.
   * Returns unsubscribe function.
   */
  onDragGeometry(listener: DragGeometryListener): () => void {
    this._dragGeometryListeners.add(listener);
    return () => this._dragGeometryListeners.delete(listener);
  }

  /**
   * Subscribe to drag end (fired once on mouseup with final geometry).
   * Used by TransformPreviewLayer to clear CSS preview on authoritative swap.
   * Returns unsubscribe function.
   */
  onDragEnd(listener: DragEndListener): () => void {
    this._dragEndListeners.add(listener);
    return () => this._dragEndListeners.delete(listener);
  }

  // ─── Legacy Subscription (For UI snapshots only) ───────────────────────────

  /**
   * Subscribe to transform state changes (throttled to 10fps).
   * NOTE: For UI updates only. Render loops should read imperatively.
   */
  subscribe(listener: TransformListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Notify legacy listeners (throttled to 10fps).
   */
  private _notifyListeners(): void {
    const now = Date.now();
    if (now - this._lastNotifyTime > this._notifyThrottleMs) {
      const state = this._activeTransform;
      this._listeners.forEach((listener) => listener(state));
      this._lastNotifyTime = now;
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Dispose controller (cleanup).
   */
  dispose(): void {
    this._activeTransform = null;
    this._currentDragGeometry = null;
    this._listeners.clear();
    this._dragGeometryListeners.clear();
    this._dragEndListeners.clear();
  }
}

/**
 * Global transform controller instance.
 */
let globalController: TransformController | null = null;

/**
 * Get or create global transform controller.
 */
export function getTransformController(): TransformController {
  if (!globalController) {
    globalController = new TransformController();
  }
  return globalController;
}

/**
 * Reset global transform controller (for testing).
 */
export function resetTransformController(): void {
  if (globalController) {
    globalController.dispose();
  }
  globalController = null;
}
