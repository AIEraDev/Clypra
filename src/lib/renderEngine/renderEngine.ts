/**
 * Render Engine
 *
 * Scoped execution engine — one per project, owned by ProjectSession.
 * NOT a global singleton. NOT a React component.
 *
 * Wires: ISM, SRP, TSP, EpochManager, InvalidationSystem, RenderScheduler.
 * Exposes reactive RenderState for hook subscription.
 *
 * React hooks access via useRenderRuntime() → RenderEngine.subscribe(clipId).
 * React components never import this directly for orchestration.
 */

import { SpatialTier, TemporalTier, InteractionState, VelocityState, RendererMode, QualityPreset, Priority, type RenderTier, type RenderState, type RenderArtifact, type ViewportBounds, type EpochDimensions, type InvalidationReason, type RenderEpochId, type IsmUpdate, DEFAULT_SRP_CONFIG, type SrpConfig } from "./types";
import { computeEpochId, validateEpoch } from "./epoch";
import { computeSpatialTier } from "./srp";
import { computeTemporalTier } from "./tsp";
import { HysteresisController } from "./hysteresis";
import { InteractionStateMachine } from "./ism";
import { RenderScheduler } from "./renderScheduler";
import { registerActiveEpoch, unregisterActiveEpoch } from "./transport";
import { FilmstripCache } from "./FilmstripCache";

// ─── Clip State ───────────────────────────────────────────────────────────────

interface ClipRenderState {
  renderState: RenderState;
  epochDimensions: EpochDimensions;
  listeners: Set<(state: RenderState) => void>;
  clipVersion: number;
  transformGraphVersion: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class RenderEngine {
  readonly projectId: string;

  private _ism: InteractionStateMachine;
  private _hysteresis: HysteresisController;
  private _scheduler: RenderScheduler;
  private _filmstripCache: FilmstripCache;
  private _clipStates = new Map<string, ClipRenderState>();
  private _ismUnsubscribe: (() => void) | null = null;

  private _currentZoom = 1.0;
  private _currentVelocityState = VelocityState.Stable;
  private _currentInteractionState = InteractionState.Idle;
  private _currentViewportBounds: ViewportBounds = { x: 0, y: 0, width: 0, height: 0 };
  private _rendererMode: RendererMode = RendererMode.Canvas2D;
  private _qualityPreset: QualityPreset = QualityPreset.Medium;

  constructor(
    projectId: string,
    options: {
      srpConfig?: SrpConfig;
      qualityPreset?: QualityPreset;
      rendererMode?: RendererMode;
      filmstripMemoryMB?: number;
    } = {},
  ) {
    this.projectId = projectId;
    this._qualityPreset = options.qualityPreset ?? QualityPreset.Medium;
    this._rendererMode = options.rendererMode ?? RendererMode.Canvas2D;

    this._ism = new InteractionStateMachine();
    const initialDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const initialTier = computeSpatialTier(this._currentZoom, initialDpr, this._qualityPreset).spatialTier;
    this._hysteresis = new HysteresisController(initialTier, options.srpConfig ?? DEFAULT_SRP_CONFIG);
    this._scheduler = new RenderScheduler();
    this._filmstripCache = new FilmstripCache(options.filmstripMemoryMB ?? 100);

    // Subscribe to ISM updates
    this._ismUnsubscribe = this._ism.subscribe((update) => this._onIsmUpdate(update));
  }

  // ── ISM Wiring ────────────────────────────────────────────────────────────

  private _onIsmUpdate(update: IsmUpdate): void {
    this._currentZoom = update.zoomLevel;
    this._currentVelocityState = update.velocityState;
    this._currentInteractionState = update.interactionState;

    // Propagate velocity to FilmstripCache for aggressive cheating
    this._filmstripCache.setVelocityState(update.velocityState);

    // Reset scheduler idle timer on any interaction
    if (update.interactionState !== InteractionState.Idle) {
      this._scheduler.resetIdleTimer();
    }

    // Recompute SRP → hysteresis → update all clip states.
    // If no clips are registered yet, seed hysteresis from the current zoom so
    // the first clip added to the timeline starts at the correct target tier.
    const srpResult = computeSpatialTier(this._currentZoom, window.devicePixelRatio, this._qualityPreset);
    if (this._clipStates.size === 0) {
      this._hysteresis.reset(srpResult.spatialTier);
    }
    const committedTier = this._hysteresis.update(this._currentZoom, srpResult.spatialTier);

    if (committedTier !== null || update.epochTrigger) {
      this._recomputeAllClipStates(update.epochTrigger);
    }
  }

  private _recomputeAllClipStates(epochTrigger: boolean): void {
    for (const [clipId, state] of this._clipStates) {
      const newState = this._buildRenderState(clipId, state);
      state.renderState = newState;
      state.epochDimensions = this._buildEpochDimensions(clipId, state);
      this._notifyListeners(clipId, newState);
    }
  }

  // ── Clip Registration ─────────────────────────────────────────────────────

  registerClip(clipId: string, options: { clipVersion?: number; transformGraphVersion?: number } = {}): void {
    if (this._clipStates.has(clipId)) return;

    const epochDimensions = this._buildEpochDimensions(clipId, {
      clipVersion: options.clipVersion ?? 0,
      transformGraphVersion: options.transformGraphVersion ?? 0,
    } as any);

    const renderState = this._buildRenderState(clipId, {
      clipVersion: options.clipVersion ?? 0,
      transformGraphVersion: options.transformGraphVersion ?? 0,
      epochDimensions,
    } as any);

    this._clipStates.set(clipId, {
      renderState,
      epochDimensions,
      listeners: new Set(),
      clipVersion: options.clipVersion ?? 0,
      transformGraphVersion: options.transformGraphVersion ?? 0,
    });

    // Register active epoch immediately to prevent race conditions during mount
    registerActiveEpoch(clipId, renderState.epochId);
  }

  unregisterClip(clipId: string): void {
    this._scheduler.cancelClip(clipId);
    this._filmstripCache.invalidateClip(clipId);
    unregisterActiveEpoch(clipId);
    this._clipStates.delete(clipId);
  }

  // ── State Building ────────────────────────────────────────────────────────

  private _buildEpochDimensions(clipId: string, state: Pick<ClipRenderState, "clipVersion" | "transformGraphVersion">): EpochDimensions {
    const srpResult = computeSpatialTier(this._currentZoom, window.devicePixelRatio, this._qualityPreset);
    const spatialTier = this._hysteresis.currentTier;

    return {
      clipId,
      clipVersion: state.clipVersion,
      transformGraphVersion: state.transformGraphVersion,
      viewportBounds: this._currentViewportBounds,
      velocityState: this._currentVelocityState,
      zoomLevel: this._currentZoom,
      spatialTier,
      temporalTier: this._spatialToTemporalTier(spatialTier),
      rendererMode: this._rendererMode,
    };
  }

  private _spatialToTemporalTier(spatial: SpatialTier): TemporalTier {
    // Default coupling: same level (R1: "coupled by default")
    return spatial as unknown as TemporalTier;
  }

  private _buildRenderState(clipId: string, state: Pick<ClipRenderState, "clipVersion" | "transformGraphVersion" | "epochDimensions">): RenderState {
    const spatialTier = this._hysteresis.currentTier;
    const temporalTier = this._spatialToTemporalTier(spatialTier);

    const currentTier: RenderTier = { spatialTier, temporalTier };
    const epochId = computeEpochId(state.epochDimensions ?? this._buildEpochDimensions(clipId, state as any));
    const previousState = this._clipStates.get(clipId)?.renderState;

    return {
      clipId,
      currentTier,
      targetTier: currentTier, // Phase 1: target = current (no pending transitions yet)
      epochId,
      interactionState: this._currentInteractionState,
      // Keep the last projection available while the new epoch converges. The
      // surface validates epoch/tier/timestamp before it commits those pixels.
      visibleArtifacts: previousState?.visibleArtifacts ?? [],
      isFallback: previousState?.isFallback ?? true,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getRenderState(clipId: string): RenderState {
    return this._clipStates.get(clipId)?.renderState ?? this._emptyState(clipId);
  }

  getScheduler(): RenderScheduler {
    return this._scheduler;
  }

  /**
   * Request filmstrip for a clip (called by ClipFilmstrip via useFilmstrip hook)
   * Viewport-bounded, epoch-gated, auto-updates RenderState.visibleArtifacts
   */
  requestFilmstrip(options: { clipId: string; videoPath: string; trimIn: number; trimOut: number; duration: number; clipStartTime: number; clipWidthPx: number; viewportScrollLeft: number; viewportWidth: number; pixelsPerSecond: number }): void {
    const state = this._clipStates.get(options.clipId);
    if (!state) {
      // Clip not registered - register it first
      this.registerClip(options.clipId);
      return this.requestFilmstrip(options);
    }

    this._filmstripCache.requestFilmstrip({
      ...options,
      spatialTier: state.renderState.currentTier.spatialTier,
      epochId: state.renderState.epochId,
      onUpdate: (artifacts) => {
        // Update RenderState.visibleArtifacts
        state.renderState = {
          ...state.renderState,
          visibleArtifacts: artifacts,
          // Once a valid projection has existed, an empty/partial transition
          // is convergence, not a return to the poster fallback state.
          isFallback: artifacts.length > 0 ? false : state.renderState.isFallback,
        };

        // Notify subscribers
        this._notifyListeners(options.clipId, state.renderState);
      },
    });
  }

  /** Populate adjacent filmstrip tiers/viewport regions after interaction settles. */
  prefetchFilmstrip(options: { clipId: string; videoPath: string; trimIn: number; trimOut: number; duration: number; clipStartTime: number; clipWidthPx: number; viewportScrollLeft: number; viewportWidth: number; pixelsPerSecond: number }): void {
    const state = this._clipStates.get(options.clipId);
    if (!state) return;

    this._filmstripCache.prefetchFilmstrip({
      ...options,
      spatialTier: state.renderState.currentTier.spatialTier,
      epochId: state.renderState.epochId,
    });
  }

  /**
   * Subscribe to render state changes for a clip.
   * Returns an unsubscribe function.
   */
  subscribe(clipId: string, listener: (state: RenderState) => void): () => void {
    const state = this._clipStates.get(clipId);
    if (!state) {
      this.registerClip(clipId);
      return this.subscribe(clipId, listener);
    }
    state.listeners.add(listener);
    // Emit current state immediately AND register the epoch
    listener(state.renderState);
    registerActiveEpoch(clipId, state.renderState.epochId);
    return () => state.listeners.delete(listener);
  }

  private _notifyListeners(clipId: string, state: RenderState): void {
    const clipState = this._clipStates.get(clipId);
    if (!clipState) return;
    for (const listener of clipState.listeners) listener(state);
    // Keep transport layer epoch registry in sync
    registerActiveEpoch(clipId, state.epochId);
  }

  /** Route an invalidation event to the correct subsystem (R20A). */
  handleInvalidation(reason: InvalidationReason, clipId?: string): void {
    switch (reason) {
      case "clip-trim-modified":
      case "clip-moved":
      case "clip-deleted":
      case "clip-modified":
        if (clipId) {
          this._scheduler.cancelTrim(clipId);
          this._bumpClipVersion(clipId);
        }
        break;

      case "tier-change-spatial":
      case "tier-change-temporal":
        // Re-validate epochs for all clips
        this._recomputeAllClipStates(true);
        break;

      case "viewport-shift-major":
      case "cache-key-mismatch":
      case "dpr-change":
        this._recomputeAllClipStates(true);
        break;
    }
  }

  private _bumpClipVersion(clipId: string): void {
    const state = this._clipStates.get(clipId);
    if (!state) return;
    state.clipVersion += 1;
    const newEpochDims = this._buildEpochDimensions(clipId, state);
    state.epochDimensions = newEpochDims;
    state.renderState = this._buildRenderState(clipId, state);
    this._notifyListeners(clipId, state.renderState);
  }

  /** Update viewport bounds (e.g. on scroll or resize). */
  updateViewport(bounds: ViewportBounds, densityHint: number): void {
    this._currentViewportBounds = bounds;
    this._ism.onViewportUpdate(bounds, densityHint);
  }

  /** Update renderer mode (Canvas2D ↔ WebGL). Triggers epoch invalidation for all clips. */
  setRendererMode(mode: RendererMode): void {
    if (this._rendererMode === mode) return;
    this._rendererMode = mode;
    this._recomputeAllClipStates(true);
  }

  /** Update quality preset (R14). Re-evaluates current tier within 16ms. */
  setQualityPreset(preset: QualityPreset): void {
    if (this._qualityPreset === preset) return;
    this._qualityPreset = preset;
    this._recomputeAllClipStates(true);
  }

  /**
   * Attach real scroll/zoom/pointer event listeners to the timeline container.
   * Returns a cleanup function. Safe to call multiple times (idempotent).
   */
  attach(timelineEl: EventTarget): () => void {
    let lastScrollX = 0;
    let lastVelocityPx = 0;
    let lastScrollTime = performance.now();

    const onScroll = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      const now = performance.now();
      const dx = el.scrollLeft - lastScrollX;
      const dt = Math.max(now - lastScrollTime, 1);
      // px/s velocity estimate
      lastVelocityPx = Math.abs(dx / (dt / 1000));
      lastScrollTime = now;

      const bounds: ViewportBounds = {
        x: el.scrollLeft,
        y: el.scrollTop,
        width: el.clientWidth,
        height: el.clientHeight,
      };
      this._currentViewportBounds = bounds;
      this._ism.onScroll(el.scrollLeft, bounds, lastVelocityPx);
      lastScrollX = el.scrollLeft;
    };

    const onWheel = (e: WheelEvent) => {
      // Ctrl+wheel = zoom in timeline (handled by Timeline.tsx);
      // we only need to record velocity for ISM
      if (e.ctrlKey || e.metaKey) {
        this._ism.onZoom(this._currentZoom, Math.abs(e.deltaY) * 10);
      } else {
        this._ism.onScroll((e.currentTarget as HTMLElement).scrollLeft ?? 0, this._currentViewportBounds, Math.abs(e.deltaY) * 30);
      }
    };

    const onPointerDown = () => {
      this._ism.onScrub();
    };
    const onPointerUp = () => {
      /* scrub ends — ISM converge timer handles it */
    };

    const el = timelineEl as HTMLElement;
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointerup", onPointerUp, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
    };
  }

  /** Called by TimelineToolbar zoom controls. */
  notifyZoom(newZoomLevel: number, velocityPxPerS = 0): void {
    this._ism.onZoom(newZoomLevel, velocityPxPerS);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  teardown(): void {
    this._ismUnsubscribe?.();
    this._ism.detach();
    // Unregister all clip epochs and cancel their jobs before disposing
    for (const clipId of this._clipStates.keys()) {
      this._scheduler.cancelClip(clipId);
      unregisterActiveEpoch(clipId);
    }
    this._scheduler.dispose();
    this._filmstripCache.dispose();
    this._clipStates.clear();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _emptyState(clipId: string): RenderState {
    const tier: RenderTier = {
      spatialTier: SpatialTier.L0,
      temporalTier: TemporalTier.L0,
    };
    const epochId = computeEpochId({
      clipId,
      clipVersion: 0,
      transformGraphVersion: 0,
      viewportBounds: { x: 0, y: 0, width: 0, height: 0 },
      velocityState: VelocityState.Stable,
      zoomLevel: 1.0,
      spatialTier: SpatialTier.L0,
      temporalTier: TemporalTier.L0,
      rendererMode: this._rendererMode,
    });
    return {
      clipId,
      currentTier: tier,
      targetTier: tier,
      epochId,
      interactionState: InteractionState.Idle,
      visibleArtifacts: [],
      isFallback: true,
    };
  }
}
