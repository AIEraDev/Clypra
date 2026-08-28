/**
 * Project Session - Disposable Runtime Container
 *
 * OWNERSHIP: Ephemeral runtime resources (playback, scheduling, GPU, decoders)
 * PERSISTENCE: Non-persistent (all resources disposed on close)
 * MUTABILITY: Manages resource lifecycle, consumes domain state as immutable input
 *
 * Phase 2 Architecture: Explicit ownership boundaries.
 *
 * Key principles:
 * - Session references global singletons (clock, scheduler) for single-instance consistency
 * - Session CONSUMES timeline state, never mutates it
 * - Session resets ephemeral UI state (selections) on init/dispose
 * - Disposal is atomic and deterministic (stops playback, cancels jobs, releases refs)
 * - Actual singleton destruction handled by destroyRuntime()
 *
 * Responsibilities:
 * - Own playback clock (transport state)
 * - Own frame scheduler (render job queue)
 * - Track video elements, audio nodes, RAF loops for cleanup
 * - Reset ephemeral UI state (selections, preview mode)
 *
 * Does NOT:
 * - Own timeline data (timelineStore is source of truth)
 * - Mutate clips/tracks (only reads for playback/render)
 * - Persist anything (all resources are session-scoped)
 * - Reset timeline store (projectStore handles load/save)
 *
 * Architecture principle:
 * Runtime resources consume timeline state as immutable input.
 * Timeline state outlives runtime sessions and is managed by projectStore.
 * This separation enables:
 * - Deterministic undo/redo (timeline mutations are journaled)
 * - Collaborative editing (timeline is CRDT-compatible)
 * - Background rendering (snapshot timeline, render in worker)
 * - Crash recovery (timeline persists, runtime restarts)
 * - AI orchestration (timeline is deterministic operation target)
 *
 * This prevents:
 * - State leakage across projects
 * - Forgotten cleanup
 * - Async tasks surviving project switch
 * - Hidden global state
 * - Resource leaks
 * - Ghost state bugs (runtime silently mutating domain state)
 */

import { getPlaybackClock, PlaybackClock } from "../playback/PlaybackClock";
import { TransportAuthority } from "../playback/TransportAuthority";
import { ProgramPlaybackContext } from "../playback/ProgramPlaybackContext";
import { SourcePlaybackContext } from "../playback/SourcePlaybackContext";

import { RenderEngine } from "@/lib/renderEngine/renderEngine";
import { QualityPreset, RendererMode, type SrpConfig } from "@/lib/renderEngine/types";
import { PreviewMediaPool, type PreviewSyncState } from "../resources/PreviewMediaPool";
import { AudioEngine } from "../audio/AudioEngine";
import { getSharedAudioEngine, stopSharedAudioEngine } from "../audio/audioRuntime";
import { isTauriRuntime } from "@/lib/platform/tauri";
import type { Clip, MediaAsset } from "@/types";
import { lifecycleMonitor } from "@/core/monitoring/LifecycleMonitor";
import { resourceTracker, installDiagnostics } from "@/core/monitoring/ResourceTracker";
import { getFrameStartTime } from "@/lib/utils/frameTime";

/**
 * Project Session State
 */
export type SessionState = "initializing" | "active" | "disposing" | "disposed";

/**
 * Session lifecycle events
 */
export type SessionEventType = "initialized" | "disposed" | "error";
export type SessionEventListener = (event: { type: SessionEventType; session: ProjectSession; error?: Error }) => void;
type SessionRegistryListener = (session: ProjectSession | null) => void;
export type SessionInitializationProgress = (progress: number, message: string) => void;

export class ProjectSession {
  // Session identity
  public readonly projectId: string;
  public readonly sessionId: string;
  private _state: SessionState = "initializing";

  // Owned subsystems (created on initialize, destroyed on dispose)
  private _playback: PlaybackClock | null = null;
  private _audioEngine: AudioEngine | null = null;
  private _renderRuntime: RenderEngine | null = null;
  private _transportAuthority: TransportAuthority | null = null;
  private _programContext: ProgramPlaybackContext | null = null;
  private _sourceContext: SourcePlaybackContext | null = null;
  private _nativeRasterBridge: import("@/core/render/nativeRasterBridge").NativeRasterBridge | null = null;
  private readonly _onInitializationProgress?: SessionInitializationProgress;

  // Lifecycle tracking
  private _initializePromise: Promise<void> | null = null;
  private _disposePromise: Promise<void> | null = null;
  private _listeners = new Set<SessionEventListener>();

  // Resource tracking (for leak detection)
  private _previewMediaPool: PreviewMediaPool | null = null;
  private _asyncTasks = new Set<AbortController>();
  private _rafIds = new Set<number>();

  constructor(projectId: string, onInitializationProgress?: SessionInitializationProgress) {
    this.projectId = projectId;
    this.sessionId = `session-${projectId}-${Date.now()}`;
    this._onInitializationProgress = onInitializationProgress;
  }

  // ─── Getters ────────────────────────────────────────────────────────────

  get state(): SessionState {
    return this._state;
  }

  get playback(): PlaybackClock {
    if (!this._playback) {
      throw new Error(`[ProjectSession] Playback not initialized. Call initialize() first.`);
    }
    return this._playback;
  }



  get renderRuntime(): RenderEngine {
    if (!this._renderRuntime) {
      throw new Error(`[ProjectSession] RenderEngine not initialized. Call initialize() first.`);
    }
    return this._renderRuntime;
  }

  get audioEngine(): AudioEngine | null {
    return this._audioEngine;
  }

  /**
   * Transport authority - single source of truth for playback ownership.
   * Returns null if not yet initialized.
   */
  get transportAuthority(): TransportAuthority | null {
    return this._transportAuthority;
  }

  /**
   * Source playback context (for binding media elements in SourcePreview).
   * Returns null if not yet initialized.
   */
  get sourceContext(): SourcePlaybackContext | null {
    return this._sourceContext;
  }

  /** Shared native preview asset bridge for session initialization and playback. */
  get nativeRasterBridge(): import("@/core/render/nativeRasterBridge").NativeRasterBridge | null {
    return this._nativeRasterBridge;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize session and all owned subsystems.
   * Must be called before using session.
   */
  async initialize(): Promise<void> {
    if (this._initializePromise) {
      return this._initializePromise;
    }

    this._initializePromise = this._doInitialize();
    return this._initializePromise;
  }

  private async _doInitialize(): Promise<void> {
    if (this._state !== "initializing") {
      throw new Error(`[ProjectSession] Cannot initialize from state: ${this._state}`);
    }

    try {
      this._onInitializationProgress?.(0.05, "Creating playback session…");
      // Use global singletons (single clock/scheduler ensures no divergence)
      this._playback = getPlaybackClock();
      // Browser program preview uses the shared Web Audio engine. Tauri
      // program preview is native-only (CPAL owns audio and time), so creating
      // an AudioContext here would reintroduce a second clock/authority.
      this._audioEngine = isTauriRuntime() ? null : getSharedAudioEngine();

      // Create playback contexts and transport authority
      this._programContext = new ProgramPlaybackContext(this._playback);
      this._sourceContext = new SourcePlaybackContext();
      this._transportAuthority = new TransportAuthority();
      this._transportAuthority.registerContext(this._programContext);
      this._transportAuthority.registerContext(this._sourceContext);
      // Default to program context
      this._transportAuthority.setActiveContext("program");

      // Create RenderEngine (session-owned, not singleton)
      // Each project gets its own render engine with isolated GPU resources
      this._renderRuntime = new RenderEngine(this.projectId, {
        qualityPreset: QualityPreset.Medium,
        rendererMode: RendererMode.Canvas2D,
      });

      // Keep the hidden video pool for native frame extraction, but never let
      // it create a second audible HTML-media path in Tauri.
      this._previewMediaPool = new PreviewMediaPool(this.projectId, this.sessionId, {
        audioEnabled: !isTauriRuntime(),
      });

      // Initialize stores (timeline, UI)
      await this._initializeStores();
      this._onInitializationProgress?.(0.35, "Initializing preview runtime…");

      // Warm existing text boundaries before the session becomes active. The
      // bridge is shared with NativeProgramPreview so first play does not
      // repeat font/effect rasterization on the transport path.
      if (isTauriRuntime()) {
        this._onInitializationProgress?.(0.55, "Prewarming text and fonts…");
        const { NativeRasterBridge } = await import("@/core/render/nativeRasterBridge");
        this._nativeRasterBridge = new NativeRasterBridge();
        // Opening is not complete until every text boundary has been warmed.
        // This is deliberately awaited: a background warmup can contend with
        // the first transport frame and recreate the entry freeze we are
        // eliminating.
        await this._prewarmNativeTextAssets();
      }

      this._onInitializationProgress?.(0.95, "Finalizing preview session…");

      this._state = "active";

      // ── Telemetry: record session creation ──────────────────────────────
      lifecycleMonitor.record("SESSION_CREATE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
      });
      resourceTracker.track({
        id: this.sessionId,
        kind: "ProjectSession",
        projectId: this.projectId,
        sessionId: this.sessionId,
      });

      this._notifyListeners({ type: "initialized", session: this });
    } catch (error) {
      this._state = "disposed";
      this._notifyListeners({ type: "error", session: this, error: error as Error });
      throw error;
    }
  }

  /**
   * Dispose session and all owned subsystems.
   * Idempotent - safe to call multiple times.
   */
  async dispose(): Promise<void> {
    if (this._disposePromise) {
      return this._disposePromise;
    }

    this._disposePromise = this._doDispose();
    return this._disposePromise;
  }

  private async _doDispose(): Promise<void> {
    if (this._state === "disposed" || this._state === "disposing") {
      return;
    }

    this._state = "disposing";

    try {
      // Deterministic teardown order (critical for avoiding race conditions)

      // 1. Cancel all async tasks (prevent new work)
      await this._cancelAsyncTasks();

      // 2. Stop playback (prevent time updates)
      if (this._playback) {
        this._playback.stop();
      }

      // 3. Teardown audio engine
      if (this._audioEngine) {
        stopSharedAudioEngine();
        this._audioEngine = null;
      }

      // 4. Release media resources (video elements, audio nodes)
      await this._releaseMediaResources();

      // 5. Teardown transport authority (disposes contexts)
      if (this._transportAuthority) {
        this._transportAuthority.dispose();
        this._transportAuthority = null;
        this._programContext = null;
        this._sourceContext = null;
      }

      // 6. Teardown render runtime (GPU resources, WebGL contexts)
      this._nativeRasterBridge?.dispose();
      this._nativeRasterBridge = null;
      if (this._renderRuntime) {
        this._renderRuntime.teardown();
        this._renderRuntime = null;
      }

      // 7. Cancel all RAF loops
      this._cancelRAFLoops();

      // 8. Release references to global singletons (actual disposal handled by destroyRuntime)
      this._playback = null;


      // 9. Reset stores
      await this._resetStores();

      this._state = "disposed";

      // ── Telemetry: record session disposal ─────────────────────────────
      lifecycleMonitor.record("SESSION_DISPOSE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
      });
      resourceTracker.release(this.sessionId);

      this._notifyListeners({ type: "disposed", session: this });
    } catch (error) {
      console.error(`[ProjectSession] Disposal error:`, error);
      this._state = "disposed"; // Mark as disposed even on error
      // Still attempt telemetry on error path
      lifecycleMonitor.record("SESSION_DISPOSE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
        detail: { error: String(error) },
      });
      resourceTracker.release(this.sessionId);
      this._notifyListeners({ type: "error", session: this, error: error as Error });
    }
  }

  // ─── Resource Management ────────────────────────────────────────────────

  /**
   * Synchronize preview media elements with timeline state.
   * Creates/destroys headless video/audio elements as needed.
   */
  syncPreviewMedia(clips: Clip[], assets: MediaAsset[], tracks: Array<{ id: string; type: string }>, syncState: PreviewSyncState): void {
    if (this._state !== "active") {
      return;
    }
    if (!this._previewMediaPool) {
      console.error(`[ProjectSession] PreviewMediaPool is null!`);
      return;
    }
    this._previewMediaPool.sync(clips, assets, tracks, syncState);
  }

  /**
   * Get active video elements for scheduler rasterization bypass.
   */
  getPreviewVideoElements(): Map<string, HTMLVideoElement> {
    return this._previewMediaPool?.getVideoElements() ?? new Map();
  }

  /** Readiness revision for repainting the native preview without changing the timeline snapshot. */
  getPreviewMediaReadyRevision(): number {
    return this._previewMediaPool?.getMediaReadyRevision() ?? 0;
  }

  /** Get the PreviewMediaPool instance for media lifecycle integration. */
  getPreviewMediaPool(): PreviewMediaPool | null {
    return this._previewMediaPool;
  }

  /**
   * Get active audio elements.
   */
  getPreviewAudioElements(): Map<string, HTMLAudioElement> {
    return this._previewMediaPool?.getAudioElements() ?? new Map();
  }

  /**
   * Immediately pause preview media elements without waiting for RAF sync.
   */
  pausePreviewMedia(): void {
    this._previewMediaPool?.pauseAll();
  }

  /**
   * Unlock the program-preview media pool and browser program engine.
   *
   * Source Preview never calls this method: source playback owns its visible
   * HTML media element through SourcePlaybackContext.
   */
  unlockProgramPreviewAudio(): void {
    this._previewMediaPool?.unlockAudio();
    this._audioEngine?.resume();
  }

  /**
   * @deprecated Video elements are now managed by PreviewMediaPool.
   * Kept for backward compatibility during transition.
   */
  registerVideoElement(_id: string, _video: HTMLVideoElement): void {
    // No-op — elements are managed by PreviewMediaPool
  }

  /**
   * @deprecated Video elements are now managed by PreviewMediaPool.
   * Kept for backward compatibility during transition.
   */
  unregisterVideoElement(_id: string): void {
    // No-op — elements are managed by PreviewMediaPool
  }

  /**
   * Register async task for cancellation on dispose.
   */
  registerAsyncTask(controller: AbortController): void {
    this._asyncTasks.add(controller);
  }

  /**
   * Unregister async task (when completed normally).
   */
  unregisterAsyncTask(controller: AbortController): void {
    this._asyncTasks.delete(controller);
  }

  /**
   * Register RAF loop for cancellation on dispose.
   */
  registerRAF(rafId: number): void {
    this._rafIds.add(rafId);
  }

  /**
   * Unregister RAF loop (when cancelled normally).
   */
  unregisterRAF(rafId: number): void {
    this._rafIds.delete(rafId);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private async _initializeStores(): Promise<void> {
    const { useUIStore } = await import("@/store/uiStore");

    // Reset UI store (selection state, preview mode)
    // Timeline store is managed by projectStore - don't touch it here
    useUIStore.setState({
      selectedClipIds: [],
      selectedTrackId: null,
      previewMode: "program",
    });

    // Reset viewport controller (imperative state)
    const { getViewportController } = await import("@/core/interactions");
    getViewportController().reset();
  }

  private async _prewarmNativeTextAssets(): Promise<void> {
    const bridge = this._nativeRasterBridge;
    if (!bridge || typeof document === "undefined") return;

    const [projectStore, timelineStore, evaluator, fontRegistry] = await Promise.all([
      import("@/store/projectStore"),
      import("@/store/timelineStore"),
      import("@/core/evaluation/evaluator"),
      import("@/core/fonts/nativeFontRegistry"),
    ]);
    const project = projectStore.useProjectStore.getState().project;
    if (!project || project.id !== this.projectId) return;

    const { clips, tracks, transitions } = timelineStore.useTimelineStore.getState();
    const mediaAssets = projectStore.useProjectStore.getState().mediaAssets;
    const textBoundaries = clips
      .filter((clip) => clip.kind === "text")
      .sort((left, right) => left.startTime - right.startTime);
    if (textBoundaries.length === 0) return;

    const frameRate = Math.max(1, project.frameRate ?? 30);
    for (const clip of textBoundaries) {
      const frameTime = getFrameStartTime(clip.startTime, frameRate);
      const scene = evaluator.evaluateTimelineScene(
        frameTime,
        clips,
        tracks,
        mediaAssets,
        project,
        transitions,
      );
      const textLayers = scene.visualLayers.filter(
        (layer) => layer.layerType === "text",
      );
      if (textLayers.length === 0) continue;

      const warmup = Promise.all([
        bridge.prewarmTextAssets(scene, "session-prewarm"),
        fontRegistry.ensureNativeFontsRegistered(
          textLayers.map((layer) => layer.fontFamily),
        ),
      ]).catch((error) => {
        console.warn("[ProjectSession] Native text prewarm failed", {
          projectId: this.projectId,
          frameTime,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      await warmup;
    }
  }

  private async _resetStores(): Promise<void> {
    // Same as initialize - reset to clean state
    await this._initializeStores();
  }

  private async _cancelAsyncTasks(): Promise<void> {
    // Cancel all registered async tasks
    for (const controller of this._asyncTasks) {
      controller.abort();
    }
    this._asyncTasks.clear();
  }

  private async _releaseMediaResources(): Promise<void> {
    // Dispose preview media pool (releases all video/audio elements)
    if (this._previewMediaPool) {
      this._previewMediaPool.dispose();
      this._previewMediaPool = null;
    }
  }

  private _cancelRAFLoops(): void {
    // Cancel all registered RAF loops
    for (const rafId of this._rafIds) {
      cancelAnimationFrame(rafId);
    }
    this._rafIds.clear();
  }

  // ─── Event System ───────────────────────────────────────────────────────

  /**
   * Subscribe to session lifecycle events.
   */
  subscribe(listener: SessionEventListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(event: { type: SessionEventType; session: ProjectSession; error?: Error }): void {
    this._listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`[ProjectSession] Listener error:`, error);
      }
    });
  }

  // ─── Debug ──────────────────────────────────────────────────────────────

  /**
   * Get session health status (for debugging).
   */
  getHealthStatus(): {
    sessionId: string;
    projectId: string;
    state: SessionState;
    playbackState: string | null;
    pendingJobs: number;
    videoElements: number;
    asyncTasks: number;
    rafLoops: number;
  } {
    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      state: this._state,
      playbackState: this._playback?.state ?? null,
      pendingJobs: 0,
      videoElements: this._previewMediaPool ? this._previewMediaPool.getVideoElements().size : 0,
      asyncTasks: this._asyncTasks.size,
      rafLoops: this._rafIds.size,
    };
  }
}

/**
 * Global session registry (single source of truth).
 * Tracks active session to prevent multiple sessions for same project.
 */
class SessionRegistry {
  private _activeSession: ProjectSession | null = null;
  private _listeners = new Set<SessionRegistryListener>();
  private _currentRequestId = 0;
  private _targetProjectId: string | null = null;

  /**
   * Get active session (if any).
   */
  getActiveSession(): ProjectSession | null {
    return this._activeSession;
  }

  /**
   * Set target project ID.
   */
  setTargetProjectId(projectId: string | null): void {
    this._targetProjectId = projectId;
  }

  /**
   * Get target project ID.
   */
  getTargetProjectId(): string | null {
    return this._targetProjectId;
  }

  /**
   * Set active session.
   * Automatically disposes previous session if exists.
   */
  async setActiveSession(session: ProjectSession | null): Promise<void> {
    const requestId = ++this._currentRequestId;

    if (session && session.projectId !== this._targetProjectId) {
      console.warn(`[SessionRegistry] Session switch discarded: session project ${session.projectId} does not match target project ${this._targetProjectId}. Disposing session.`);
      await session.dispose();
      return;
    }

    if (this._activeSession && this._activeSession !== session) {
      const oldSession = this._activeSession;
      this._activeSession = null;
      if (typeof globalThis !== "undefined") {
        (globalThis as any).__activeProjectSession = null;
      }
      this._notifyListeners();
      await oldSession.dispose();
    }

    // Only set the session if this request has not been superceded by a newer switch
    if (requestId === this._currentRequestId) {
      this._activeSession = session;
      if (typeof globalThis !== "undefined") {
        (globalThis as any).__activeProjectSession = session;
      }
      this._notifyListeners();
    } else {
      console.warn(`[SessionRegistry] Session switch superceded (request ${requestId} vs current ${this._currentRequestId}). Disposing orphaned session.`);
      if (session) {
        await session.dispose();
      }
    }
  }

  /**
   * Clear active session (dispose and remove).
   */
  async clearActiveSession(): Promise<void> {
    await this.setActiveSession(null);
  }

  subscribe(listener: SessionRegistryListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(): void {
    this._listeners.forEach((listener) => {
      try {
        listener(this._activeSession);
      } catch (error) {
        console.error(`[ProjectSession] Session registry listener error:`, error);
      }
    });
  }
}

// Global registry instance
const sessionRegistry = new SessionRegistry();

/**
 * Get active project session.
 * Throws if no session is active.
 */
export function getActiveSession(): ProjectSession {
  const session = sessionRegistry.getActiveSession();
  if (!session) {
    throw new Error(`[ProjectSession] No active session. Create and initialize a session first.`);
  }
  return session;
}

/**
 * Get active project session (nullable).
 * Returns null if no session is active.
 */
export function getActiveSessionOrNull(): ProjectSession | null {
  const session = sessionRegistry.getActiveSession();
  if (!session || session.state !== "active") {
    return null;
  }
  return session;
}

/**
 * Subscribe to active session changes.
 * Useful for React components that need to react when session becomes available.
 */
export function subscribeToSessionChanges(listener: () => void): () => void {
  return sessionRegistry.subscribe(() => listener());
}

/**
 * Create and activate new project session.
 * Automatically disposes previous session if exists.
 */
export async function createProjectSession(
  projectId: string,
  options: { onProgress?: SessionInitializationProgress } = {},
): Promise<ProjectSession> {
  // Install diagnostics on first session creation (idempotent)
  installDiagnostics();
  // Also attach lifecycle log to the diagnostics surface
  if (typeof window !== "undefined") {
    const diag = (window as any).__clypra_diagnostics ?? {};
    (window as any).__clypra_diagnostics = { ...diag, lifecycle: lifecycleMonitor };
  }

  lifecycleMonitor.record("PROJECT_LOAD_START", { projectId });

  sessionRegistry.setTargetProjectId(projectId);

  const session = new ProjectSession(projectId, options.onProgress);
  try {
    await session.initialize();
  } catch (err) {
    if (sessionRegistry.getTargetProjectId() === projectId) {
      sessionRegistry.setTargetProjectId(null);
    }
    throw err;
  }
  await sessionRegistry.setActiveSession(session);

  lifecycleMonitor.record("PROJECT_LOAD_COMPLETE", { projectId, sessionId: session.sessionId });

  return session;
}

/**
 * Dispose active project session.
 */
export async function disposeActiveSession(): Promise<void> {
  sessionRegistry.setTargetProjectId(null);
  await sessionRegistry.clearActiveSession();
}
