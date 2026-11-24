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
import {
  QualityPreset,
  RendererMode,
  type SrpConfig,
} from "@/lib/renderEngine/types";
import {
  PreviewMediaPool,
  type PreviewSyncState,
} from "../resources/PreviewMediaPool";
import { AudioEngine } from "../audio/AudioEngine";
import {
  getSharedAudioEngine,
  prewarmSharedAudioBuffers,
  stopSharedAudioEngine,
} from "../audio/audioRuntime";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Clip, MediaAsset } from "@/types";
import { appLifecycleCoordinator } from "./AppLifecycleCoordinator";
import { lifecycleMonitor } from "@/core/monitoring/LifecycleMonitor";
import {
  resourceTracker,
  installDiagnostics,
} from "@/core/monitoring/ResourceTracker";
import { getFrameStartTime } from "@/lib/utils/frameTime";
import { perfLogService } from "@/services/perfLogService";

type SessionLoadStage =
  | "stores"
  | "preview-runtime"
  | "audio-prewarm"
  | "fonts"
  | "native-raster-bridge-init"
  | "native-raster-critical"
  | "native-raster-deferred";

type SessionLoadTimings = Partial<Record<SessionLoadStage, number>>;

type SessionCloseStage =
  | "cancel-work"
  | "stop-playback"
  | "stop-audio"
  | "release-media"
  | "release-transport"
  | "release-rendering"
  | "reset-stores";

type SessionCloseTimings = Partial<Record<SessionCloseStage, number>>;

// The first boundary is the only one that can affect the initially visible
// frame. Every additional boundary grows project-open time on older Intel
// systems because it serializes canvas rasterization and native texture upload.
const CRITICAL_NATIVE_RASTER_BOUNDARIES = 1;

/**
 * Guards audio-prewarm cold-start telemetry so it fires at most once per
 * project session lifetime. Reset upon session disposal so each opened project
 * captures its own clean initialization telemetry.
 */
let _hasRecordedAudioPrewarm = false;

export function resetAudioPrewarmTelemetryState(): void {
  _hasRecordedAudioPrewarm = false;
}

/**
 * Project Session State
 */
export type SessionState = "initializing" | "active" | "disposing" | "disposed";

/**
 * Session lifecycle events
 */
export type SessionEventType = "initialized" | "disposed" | "error";
export type SessionEventListener = (event: {
  type: SessionEventType;
  session: ProjectSession;
  error?: Error;
}) => void;
type SessionRegistryListener = (session: ProjectSession | null) => void;
export type SessionInitializationProgress = (
  progress: number,
  message: string,
) => void;

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
  private _nativeRasterBridge:
    | import("@/core/render/nativeRasterBridge").NativeRasterBridge
    | null = null;
  private readonly _onInitializationProgress?: SessionInitializationProgress;
  /**
   * Font families referenced by this project's text clips that are not in
   * the bundled/system font registry. Populated during session init.
   * These clips will render with a fallback font until the font is installed
   * or the user replaces it. The original fontFamily string is preserved in
   * the project data (never silently mutated).
   */
  private _missingFontFamilies: string[] = [];

  // Lifecycle tracking
  private _initializePromise: Promise<void> | null = null;
  private _disposePromise: Promise<void> | null = null;
  private _listeners = new Set<SessionEventListener>();

  // Resource tracking (for leak detection)
  private _previewMediaPool: PreviewMediaPool | null = null;
  private _asyncTasks = new Set<AbortController>();
  private _rafIds = new Set<number>();
  private _nativeRasterIdlePrewarmTimer: ReturnType<typeof setTimeout> | null =
    null;

  /**
   * AbortController for the background audio hydration task launched by
   * `_prewarmNativeAudioGraph` when the timeline is longer than the initial
   * prewarm window. Aborted on session dispose or if a new session opens.
   */
  private _bgAudioHydrationController: AbortController | null = null;

  /**
   * Base synchronous prewarm window (seconds) for single-video-track projects.
   * Only audio clips overlapping [0, prewarmWindowEnd] are decoded during
   * project open; the remainder is hydrated by `_scheduleBackgroundAudioHydration`.
   *
   * For multi-video-track projects the window is scaled down proportionally
   * (`_computePrewarmWindowSeconds`) so that total prewarm wall-time stays
   * bounded regardless of track count. Session J telemetry: 2 tracks × 90 s
   * = 912 ms; 2 tracks × 30 s ≈ 300 ms (−67%).
   */
  private static readonly PREWARM_WINDOW_BASE_SECONDS = 30;
  private static readonly PREWARM_WINDOW_MAX_SECONDS = 90;
  /**
   * Tracks how many raster boundaries were warmed during the critical project-open
   * barrier so the deferred idle prewarm starts at the correct offset.
   */
  private _lastCriticalRasterWarmedCount = 0;
  private _fontIdlePrewarmTimer: ReturnType<typeof setTimeout> | null = null;
  private _filmstripPrewarmTimer: ReturnType<typeof setTimeout> | null = null;
  private _stackedBoundaryWarmupTimer: ReturnType<typeof setTimeout> | null =
    null;
  private _nativeRasterPrewarmInFlight: Promise<boolean> | null = null;
  private _nativePreviewStartupUnlisten: UnlistenFn | null = null;
  private _nativePreviewStartupTimeout: ReturnType<typeof setTimeout> | null =
    null;
  private _initializationTimingsMs: SessionLoadTimings = {};
  private _disposalTimingsMs: SessionCloseTimings = {};
  private _mediaPresenceTimer: ReturnType<typeof setInterval> | null = null;
  private _lifecycleWakeupUnsub: (() => void) | null = null;

  constructor(
    projectId: string,
    onInitializationProgress?: SessionInitializationProgress,
  ) {
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
      throw new Error(
        `[ProjectSession] Playback not initialized. Call initialize() first.`,
      );
    }
    return this._playback;
  }

  get renderRuntime(): RenderEngine {
    if (!this._renderRuntime) {
      throw new Error(
        `[ProjectSession] RenderEngine not initialized. Call initialize() first.`,
      );
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
  get nativeRasterBridge():
    | import("@/core/render/nativeRasterBridge").NativeRasterBridge
    | null {
    return this._nativeRasterBridge;
  }

  /**
   * Font families referenced by this project that are not in the bundled
   * registry. Empty when all fonts are known. Populated after initialize().
   *
   * These represent missing-font conditions: the clip data is unchanged,
   * but the font cannot be loaded offline. Show a diagnostic to the user.
   */
  get missingFontFamilies(): readonly string[] {
    return this._missingFontFamilies;
  }

  /** Content-free timing evidence for the current project-open sequence. */
  get initializationTimingsMs(): Readonly<SessionLoadTimings> {
    return { ...this._initializationTimingsMs };
  }

  /** Content-free timing evidence for the current project-close sequence. */
  get disposalTimingsMs(): Readonly<SessionCloseTimings> {
    return { ...this._disposalTimingsMs };
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

  /**
   * Warm raster assets after timeline mutations as well as during project
   * opening. This is intentionally public so inserting a template cannot
   * make the first program-preview frame pay the native upload cost.
   */
  async prewarmNativeRasterAssets(): Promise<void> {
    if (!isTauriRuntime() || this._state !== "active") return;
    await this._prewarmNativeRasterAssets();
  }

  /**
   * Prewarms a specific clip at a given timestamp (defaulting to clip.startTime).
   * Evaluates only the frame containing the clip, registers required fonts,
   * dispatches rendering off-thread to the Worker, and registers the texture
   * with the native raster bridge before playback or preview begins.
   */
  async prewarmClip(clip: Clip, atTime?: number): Promise<void> {
    if (!isTauriRuntime() || this._state !== "active") return;
    const bridge = this._nativeRasterBridge;
    if (!bridge || typeof document === "undefined") return;

    try {
      const [projectStore, timelineStore, evaluator, fontRegistry] =
        await Promise.all([
          import("@/store/projectStore"),
          import("@/store/timelineStore"),
          import("@/core/evaluation/evaluator"),
          import("@/core/fonts/nativeFontRegistry"),
        ]);

      const project = projectStore.useProjectStore.getState().project;
      if (!project || project.id !== this.projectId) return;

      const { clips, tracks, transitions } = timelineStore.useTimelineStore.getState();
      const mediaAssets = projectStore.useProjectStore.getState().mediaAssets;
      const frameRate = Math.max(1, project.frameRate ?? 30);
      const targetTime = atTime ?? clip.startTime;
      const frameTime = getFrameStartTime(targetTime, frameRate);

      // Ensure the clip is in the evaluated list
      const effectiveClips = clips.some((c) => c.id === clip.id) ? clips : [...clips, clip];

      const scene = evaluator.evaluateTimelineScene(
        frameTime,
        effectiveClips,
        tracks,
        mediaAssets,
        project,
        transitions,
      );

      const textLayers = scene.visualLayers.filter(
        (layer): layer is import("@/core/evaluation/types").EvaluatedTextLayer =>
          layer.layerType === "text" && (layer.clipId === clip.id || layer.layerId.startsWith(clip.id)),
      );
      const imageLayers = scene.visualLayers.filter(
        (layer) =>
          layer.layerType === "media" &&
          layer.mediaType === "image" &&
          layer.stickerFormat !== "gif" &&
          layer.stickerFormat !== "lottie" &&
          (layer.clipId === clip.id || layer.layerId.startsWith(clip.id)),
      );
      const stickerLayers = scene.visualLayers.filter(
        (layer): layer is import("@/core/evaluation/types").EvaluatedMediaLayer =>
          layer.layerType === "media" &&
          layer.clipKind === "sticker" &&
          (layer.clipId === clip.id || layer.layerId.startsWith(clip.id)),
      );

      if (textLayers.length === 0 && imageLayers.length === 0 && stickerLayers.length === 0) return;

      await Promise.all([
        textLayers.length > 0
          ? bridge.prewarmTextAssets(scene, "session-prewarm")
          : Promise.resolve(),
        textLayers.length > 0
          ? fontRegistry.ensureNativeFontsRegistered(
              textLayers.map((layer) => layer.fontFamily),
            )
          : Promise.resolve(),
        imageLayers.length > 0
          ? bridge.prewarmImageAssets(scene)
          : Promise.resolve(),
        stickerLayers.length > 0
          ? bridge.rasterize(scene, {
              frameKey: 0,
              stickerPhase: "sticker-prefetch",
              nonBlockingStickers: false,
            })
          : Promise.resolve(),
      ]);
    } catch (error) {
      console.warn("[ProjectSession] Clip raster prewarm failed", {
        projectId: this.projectId,
        clipId: clip.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async _doInitialize(): Promise<void> {
    if (this._state !== "initializing") {
      throw new Error(
        `[ProjectSession] Cannot initialize from state: ${this._state}`,
      );
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
      const [{ useProjectStore }, { useTimelineStore: useTimelineStoreRef }] = await Promise.all([
        import("@/store/projectStore"),
        import("@/store/timelineStore"),
      ]);
      this._transportAuthority = new TransportAuthority();
      this._transportAuthority.setCanPlayGuard(() => {
        const projectState = useProjectStore.getState();
        const timelineState = useTimelineStoreRef.getState();
        const missingAssetIds = new Set(
          (projectState.mediaAssets ?? [])
            .filter((asset) => asset.isMissing)
            .map((asset) => asset.id),
        );
        if (missingAssetIds.size === 0) return true;
        const hasOfflineTimelineClip = (timelineState.clips ?? []).some(
          (clip) => clip.mediaId && missingAssetIds.has(clip.mediaId),
        );
        if (hasOfflineTimelineClip) {
          projectState.showToast(
            "Cannot play: one or more timeline media files are missing or offline. Use Relink Media to locate.",
            "warning",
            5000,
          );
          return false;
        }
        return true;
      });
      this._transportAuthority.registerContext(this._programContext);
      this._transportAuthority.registerContext(this._sourceContext);
      // Default to program context
      this._transportAuthority.setActiveContext("program");

      // Keep the hidden video pool for native frame extraction, but never let
      // it create a second audible HTML-media path in Tauri.
      this._previewMediaPool = new PreviewMediaPool(
        this.projectId,
        this.sessionId,
        {
          audioEnabled: !isTauriRuntime(),
        },
      );

      // Initialize stores (timeline, UI) BEFORE creating RenderEngine so we
      // can read the hydrated zoom level and seed the engine at the correct
      // tier, eliminating the transient L1→L0 churn on first clip register.
      await this._measureInitializationStage("stores", () =>
        this._initializeStores(),
      );
      this._onInitializationProgress?.(0.35, "Initializing preview runtime…");

      // Derive initial zoom from the store that was just hydrated.
      // TIMELINE_PPS_PER_ZOOM = 100, so zoom = pixelsPerSecond / 100.
      const { useTimelineStore } = await import("@/store/timelineStore");
      const { TIMELINE_PPS_PER_ZOOM } = await import("@/lib/timeline/timelineZoom");
      const hydratedPps = useTimelineStore.getState().pixelsPerSecond;
      const initialZoom = hydratedPps / TIMELINE_PPS_PER_ZOOM;

      // Create RenderEngine (session-owned, not singleton).
      // Each project gets its own render engine with isolated GPU resources.
      // Seeding initialZoom ensures the first clip registers at the correct
      // tier before Timeline.tsx's RAF fires setZoom(TIMELINE_ZOOM_MIN).
      await this._measureInitializationStage("preview-runtime", async () => {
        this._renderRuntime = new RenderEngine(this.projectId, {
          qualityPreset: QualityPreset.Medium,
          rendererMode: RendererMode.Canvas2D,
          initialZoom,
        });
        if (isTauriRuntime()) {
          // Do not let cold timeline thumbnails occupy the native decode/GPU
          // path before Program Preview has produced its first real frame.
          this._renderRuntime.setNativePreviewReady(false);
          void this._installNativePreviewStartupGate(this._renderRuntime);
        }
      });

      if (!isTauriRuntime()) {
        this._onInitializationProgress?.(0.45, "Prewarming audio…");
        await this._measureInitializationStage("audio-prewarm", () =>
          this._prewarmAudioAssets(),
        );
      } else {
        this._onInitializationProgress?.(0.45, "Preparing audio graph…");
        await this._measureInitializationStage("audio-prewarm", () =>
          this._prewarmNativeAudioGraph(),
        );
      }

      // Warm existing text/image boundaries before the session becomes active.
      // The bridge is shared with NativeProgramPreview so first play does not
      // repeat first-use rasterization or native image decoding on the
      // transport path.
      if (isTauriRuntime()) {
        this._onInitializationProgress?.(0.55, "Prewarming text and images…");

        // ── Telemetry: isolate raster bridge dynamic import + construction ──
        // The gap between s2_audio_prewarm_total and s2_session_audio-prewarm
        // seen in some sessions may be caused by the dynamic import chain or
        // NativeRasterBridge constructor below. This stage span makes it
        // observable in the fleet perf log.
        await this._measureInitializationStage("native-raster-bridge-init", async () => {
          const { NativeRasterBridge } =
            await import("@/core/render/nativeRasterBridge");
          this._nativeRasterBridge = new NativeRasterBridge();
        });

        // Warming every project's font up front can take seconds on older
        // Windows hardware. The first raster boundary still registers the
        // font it needs; all other fonts warm once the editor is usable.
        this._scheduleDeferredProjectFontPrewarm();

        // Only boundaries visible at the initial playhead position are part of the
        // open barrier. Warming every future text/image boundary made project-open
        // cost grow with timeline length, even though those assets cannot affect
        // the first frame presented to the user. The remainder is yielded until
        // the browser is idle and is still registered before it becomes visible.
        const initialPlayheadTime = this._playback?.time ?? 0;
        const deferredRasterBoundaries = await this._measureInitializationStage(
          "native-raster-critical",
          () =>
            this._prewarmNativeRasterAssets({
              startIndex: 0,
              limit: CRITICAL_NATIVE_RASTER_BOUNDARIES,
              activeAtTime: initialPlayheadTime,
            }),
        );
        if (deferredRasterBoundaries) {
          this._scheduleDeferredNativeRasterPrewarm(
            this._lastCriticalRasterWarmedCount,
          );
        }
      }

      this._onInitializationProgress?.(0.95, "Finalizing preview session…");

      this._state = "active";

      // The timer is registered above but must not run before the session is
      // observable as active; otherwise a close during initialization can let
      // background canvas work outlive this session.
      this._startDeferredNativeRasterPrewarm();
      this._scheduleStackedBoundaryDecodeWarmup();

      // ── Background filmstrip coarse-baseline pre-warm ────────────────────
      // The first filmstrip tile fetch after project open can stall 4+ seconds
      // because OPFS and the video decoder are both cold (observed: 4,328ms on
      // M1). Pre-warm the coarse thumbnail tier for every video clip here,
      // fire-and-forget, so the OPFS atlas and Rust thumbnail cache are already
      // populated before the user can scroll the filmstrip.
      //
      // Defer this by 4 seconds so the immediate viewport filmstrip fetch and
      // program preview have exclusive access to decoder/GPU queues during open.
      this._filmstripPrewarmTimer = setTimeout(() => {
        this._filmstripPrewarmTimer = null;
        if (this._state === "active") {
          void this._prewarmFilmstripCoarseBaseline();
        }
      }, 4000);

      // ── Media presence monitor (NLE architecture) ─────────────────────────
      // When the user tabs back into Clypra or on a lightweight background interval,
      // verify that all media asset files still exist on disk. If a media file is
      // deleted, moved, or restored while the session is running, immediately
      // invalidate caches and update UI so the user does NOT have to restart the session.
      this._lifecycleWakeupUnsub = appLifecycleCoordinator.onForegroundWakeup(() => {
        if (this._state === "active") {
          void this._checkMediaPresenceLive();
        }
      });

      this._mediaPresenceTimer = setInterval(() => {
        if (
          this._state === "active" &&
          this._transportAuthority?.getState() !== "playing"
        ) {
          void this._checkMediaPresenceLive();
        }
      }, 5000);

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
      _hasRecordedAudioPrewarm = false;
      this._lastCriticalRasterWarmedCount = 0;
      this._notifyListeners({
        type: "error",
        session: this,
        error: error as Error,
      });
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
    this._releaseNativePreviewStartupGate();
    const disposalStartedAt = performance.now();
    lifecycleMonitor.record("PROJECT_CLOSE_START", {
      projectId: this.projectId,
      sessionId: this.sessionId,
    });

    try {
      // Stop producers before tearing down the resources they can touch. The
      // remaining release operations are measured individually so a slow close
      // can be attributed to media, audio, rendering, or UI-store cleanup.
      await this._measureDisposalStage("cancel-work", () =>
        this._cancelAsyncTasks(),
      );
      await this._measureDisposalStage("stop-playback", async () => {
        this._playback?.stop();
      });
      await this._measureDisposalStage("stop-audio", async () => {
        if (this._audioEngine) {
          stopSharedAudioEngine();
          this._audioEngine = null;
        }
      });
      await this._measureDisposalStage("release-media", () =>
        this._releaseMediaResources(),
      );
      await this._measureDisposalStage("release-transport", async () => {
        this._transportAuthority?.dispose();
        this._transportAuthority = null;
        this._programContext = null;
        this._sourceContext = null;
      });
      await this._measureDisposalStage("release-rendering", async () => {
        this._releaseNativePreviewStartupGate();
        this._nativeRasterBridge?.dispose();
        this._nativeRasterBridge = null;
        if (this._renderRuntime) {
          this._renderRuntime.teardown();
          this._renderRuntime = null;
        }
      });
      if (this._nativeRasterIdlePrewarmTimer !== null) {
        clearTimeout(this._nativeRasterIdlePrewarmTimer);
        this._nativeRasterIdlePrewarmTimer = null;
      }
      if (this._fontIdlePrewarmTimer !== null) {
        clearTimeout(this._fontIdlePrewarmTimer);
        this._fontIdlePrewarmTimer = null;
      }
      if (this._filmstripPrewarmTimer !== null) {
        clearTimeout(this._filmstripPrewarmTimer);
        this._filmstripPrewarmTimer = null;
      }
      if (this._stackedBoundaryWarmupTimer !== null) {
        clearTimeout(this._stackedBoundaryWarmupTimer);
        this._stackedBoundaryWarmupTimer = null;
      }
      if (this._mediaPresenceTimer !== null) {
        clearInterval(this._mediaPresenceTimer);
        this._mediaPresenceTimer = null;
      }
      if (this._lifecycleWakeupUnsub !== null) {
        this._lifecycleWakeupUnsub();
        this._lifecycleWakeupUnsub = null;
      }
      this._cancelRAFLoops();
      this._playback = null;
      await this._measureDisposalStage("reset-stores", () =>
        this._resetStores(),
      );

      this._state = "disposed";
      _hasRecordedAudioPrewarm = false;
      this._lastCriticalRasterWarmedCount = 0;

      // ── Telemetry: record session disposal ─────────────────────────────
      lifecycleMonitor.record("SESSION_DISPOSE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
      });
      const detail = {
        durationMs: Math.round(Math.max(0, performance.now() - disposalStartedAt)),
        stagesMs: this.disposalTimingsMs,
      };
      lifecycleMonitor.record("PROJECT_CLOSE_COMPLETE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
        detail,
      });
      perfLogService.enqueue({
        kind: "project-session-close",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: { stage: "complete", ...detail },
      });
      resourceTracker.release(this.sessionId);

      this._notifyListeners({ type: "disposed", session: this });
    } catch (error) {
      console.error(`[ProjectSession] Disposal error:`, error);
      this._state = "disposed";
      _hasRecordedAudioPrewarm = false;
      this._lastCriticalRasterWarmedCount = 0; // Mark as disposed even on error
      const detail = {
        durationMs: Math.round(Math.max(0, performance.now() - disposalStartedAt)),
        stagesMs: this.disposalTimingsMs,
      };
      lifecycleMonitor.record("PROJECT_CLOSE_FAILED", {
        projectId: this.projectId,
        sessionId: this.sessionId,
        detail,
      });
      perfLogService.enqueue({
        kind: "project-session-close",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: { stage: "failed", ...detail },
      });
      // Still attempt telemetry on error path
      lifecycleMonitor.record("SESSION_DISPOSE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
        detail: { error: String(error) },
      });
      resourceTracker.release(this.sessionId);
      this._notifyListeners({
        type: "error",
        session: this,
        error: error as Error,
      });
    }
  }

  // ─── Resource Management ────────────────────────────────────────────────

  /**
   * Synchronize preview media elements with timeline state.
   * Creates/destroys headless video/audio elements as needed.
   */
  syncPreviewMedia(
    clips: Clip[],
    assets: MediaAsset[],
    tracks: Array<{ id: string; type: string }>,
    syncState: PreviewSyncState,
  ): void {
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
   * Invalidate all cached GPU textures, video elements, and decoders for an offline/missing media asset.
   * Frees system and GPU memory immediately (NLE-style architecture).
   */
  async invalidateMissingMediaAsset(asset: MediaAsset): Promise<void> {
    this._previewMediaPool?.evictMissingAsset(asset.id);
    if (asset.path) {
      await this._nativeRasterBridge?.invalidateMediaAsset(asset.path);
    }
    if (asset.posterFrame) {
      await this._nativeRasterBridge?.invalidateMediaAsset(asset.posterFrame);
    }
  }

  /**
   * Live watchdog check for media file presence on disk.
   * Runs in the background and on window focus so user never has to restart the session to notice missing files.
   */
  private async _checkMediaPresenceLive(): Promise<void> {
    try {
      const { useProjectStore } = await import("@/store/projectStore");
      const prevAssets = useProjectStore.getState().mediaAssets;
      const missingIds = await useProjectStore.getState().checkMissingMedia();
      const nextAssets = useProjectStore.getState().mediaAssets;

      for (const next of nextAssets) {
        const prev = prevAssets.find((p) => p.id === next.id);
        if (next.isMissing && !prev?.isMissing) {
          await this.invalidateMissingMediaAsset(next);
        }
      }
    } catch (err) {
      console.warn("[ProjectSession] Live media presence check failed:", err);
    }
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

  /**
   * The native renderer publishes this milestone only after a real frame has
   * reached the Program Preview surface. Releasing filmstrip work here keeps
   * first-frame latency independent from the number of visible timeline tiles.
   */
  private async _installNativePreviewStartupGate(runtime: RenderEngine): Promise<void> {
    try {
      const unlisten = await listen<{ stage?: string }>(
        "clypra://native-playback-startup",
        ({ payload }) => {
          if (payload.stage !== "first-native-frame-presented") return;
          runtime.setNativePreviewReady(true);
          this._releaseNativePreviewStartupGate();
        },
      );

      if (this._state === "disposing" || this._state === "disposed" || this._renderRuntime !== runtime) {
        unlisten();
        return;
      }
      this._nativePreviewStartupUnlisten = unlisten;

      // A capability failure must not leave timeline imagery permanently
      // suppressed. This is a safety release only; normal desktop sessions
      // release as soon as the first native frame is presented.
      this._nativePreviewStartupTimeout = setTimeout(() => {
        runtime.setNativePreviewReady(true);
        this._releaseNativePreviewStartupGate();
      }, 500);
    } catch {
      // Older/native-disabled runtimes have no startup event; preserve the
      // ordinary filmstrip behavior rather than withholding imagery.
      runtime.setNativePreviewReady(true);
    }
  }

  private _releaseNativePreviewStartupGate(): void {
    if (this._nativePreviewStartupTimeout !== null) {
      clearTimeout(this._nativePreviewStartupTimeout);
      this._nativePreviewStartupTimeout = null;
    }
    if (this._nativePreviewStartupUnlisten) {
      this._nativePreviewStartupUnlisten();
      this._nativePreviewStartupUnlisten = null;
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private async _initializeStores(): Promise<void> {
    const [{ useUIStore }, { getViewportController }] = await Promise.all([
      import("@/store/uiStore"),
      import("@/core/interactions"),
    ]);

    // Reset UI store (selection state, preview mode)
    // Timeline store is managed by projectStore - don't touch it here
    useUIStore.setState({
      selectedClipIds: [],
      selectedTrackId: null,
      previewMode: "program",
    });

    // Reset viewport controller (imperative state)
    getViewportController().reset();
  }

  private async _measureInitializationStage<T>(
    stage: SessionLoadStage,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      const durationMs = Math.max(0, performance.now() - startedAt);
      this._initializationTimingsMs[stage] = durationMs;
      const detail = {
        stage,
        durationMs: Math.round(durationMs),
        projectSessionId: this.sessionId,
      };
      lifecycleMonitor.record("PROJECT_LOAD_STAGE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
        detail,
      });
      // Stage names, durations, and counts are deliberately content-free.
      // They let fleet analysis identify whether stores, fonts, or raster
      // preparation is responsible for slow opens without exporting projects,
      // media paths, or text content.
      perfLogService.enqueue({
        kind: "project-session-load",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: detail,
      });
      try {
        const { recordColdStartSpan } = await import("@/lib/platform/tauri");
        void recordColdStartSpan(
          `s2_session_${stage}`,
          Math.round(startedAt * 1000),
          Math.round(durationMs * 1000),
          Math.round(durationMs * 1000),
          false,
          true,
          "session",
        );
      } catch (_) {}
    }
  }

  private async _measureDisposalStage<T>(
    stage: SessionCloseStage,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      const durationMs = Math.max(0, performance.now() - startedAt);
      this._disposalTimingsMs[stage] = durationMs;
      const detail = {
        stage,
        durationMs: Math.round(durationMs),
        projectSessionId: this.sessionId,
      };
      lifecycleMonitor.record("PROJECT_CLOSE_STAGE", {
        projectId: this.projectId,
        sessionId: this.sessionId,
        detail,
      });
      perfLogService.enqueue({
        kind: "project-session-close",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: detail,
      });
    }
  }

  private async _prewarmProjectFonts(): Promise<void> {
    const [projectStore, timelineStore, fontLoader, fontRegistry, registry] =
      await Promise.all([
        import("@/store/projectStore"),
        import("@/store/timelineStore"),
        import("@/core/fonts/FontLoader"),
        import("@/core/fonts/nativeFontRegistry"),
        import("@/core/fonts/fontRegistry"),
      ]);

    const project = projectStore.useProjectStore.getState().project;
    if (!project || project.id !== this.projectId) return;

    const { clips } = timelineStore.useTimelineStore.getState();

    // Collect unique font families from all text/text-template clips.
    const textClips = clips.filter(
      (clip) => clip.kind === "text" || clip.kind === "text-template",
    ) as Array<{ fontFamily?: string; fontId?: string }>;

    const fontFamilies = [
      ...new Set(
        textClips
          .map((clip) => clip.fontFamily)
          .filter((f): f is string => Boolean(f?.trim())),
      ),
    ];

    // ── Missing-font detection ─────────────────────────────────────────────
    // A font is "missing" if it is not a known bundled/system font and cannot
    // be resolved offline. We surface this as a console warning and store the
    // list on the session for diagnostic use. We do NOT mutate the clip —
    // the original fontFamily value is preserved so the project is portable.
    const missingFamilies = fontFamilies.filter(
      (family) => !registry.isKnownFont(family),
    );
    if (missingFamilies.length > 0) {
      console.warn(
        `[ProjectSession] Project references ${missingFamilies.length} font(s) not in the bundled registry. ` +
          `These will render with a fallback font. Missing: ${missingFamilies.join(", ")}`,
      );
    }
    this._missingFontFamilies = missingFamilies;

    if (fontFamilies.length === 0) {
      // No text clips — still schedule idle prewarm so the font picker is
      // warm when the user first opens it.
      fontLoader.getFontLoader().prewarmRemainingFontsOnIdle();
      fontRegistry.prewarmNativeFontsOnIdle();
      return;
    }

    // Warm browser document.fonts and the native Rust registry in parallel.
    // Errors in either path are swallowed — a failure here means first-frame
    // font-wait cost is paid, not a hard error.
    await Promise.allSettled([
      fontLoader.getFontLoader().prewarmProjectFonts(fontFamilies),
      fontRegistry.ensureNativeFontsRegistered(fontFamilies),
    ]);

    // Schedule remaining bundled fonts for idle loading so the font picker
    // shows instant previews without blocking the project open sequence.
    fontLoader.getFontLoader().prewarmRemainingFontsOnIdle();
    fontRegistry.prewarmNativeFontsOnIdle();
  }

  /**
   * Background-warm the coarse filmstrip tile tier for all video clips.
   *
   * The first cold decode of a filmstrip tile can stall 4+ seconds on macOS
   * when the APFS page-cache and the Rust thumbnail decoder are both cold.
   * Calling `preloadAssetCoarseBaseline` here triggers the thumbnail engine to
   * decode and cache coarse-tier tiles across the full video duration at low
   * priority (priority=3), so the OPFS atlas is warm before the user scrolls.
   *
   * This is fire-and-forget. Errors are swallowed — a failure only means the
   * first filmstrip scroll may still be slow, which is the current baseline.
   */
  private async _prewarmFilmstripCoarseBaseline(): Promise<void> {
    if (!this._renderRuntime) return;
    const runtime = this._renderRuntime;

    try {
      const [{ useProjectStore }, { useTimelineStore }] = await Promise.all([
        import("@/store/projectStore"),
        import("@/store/timelineStore"),
      ]);
      const mediaAssets = useProjectStore.getState().mediaAssets;
      const { clips } = useTimelineStore.getState();
      const assetMap = new Map(mediaAssets.map((a) => [a.id, a]));

      // Collect unique video assets referenced by clips (deduplicated by path).
      const seenPaths = new Set<string>();
      for (const clip of clips) {
        if (this._state === "disposed" || this._state === "disposing") return;
        const asset = assetMap.get(clip.mediaId ?? "");
        if (!asset || asset.type !== "video") continue;
        const videoPath = asset.path ?? "";
        if (!videoPath || seenPaths.has(videoPath)) continue;
        seenPaths.add(videoPath);

        // Kick off coarse baseline load and yield to avoid saturating the
        // thumbnail worker queue during the session open sequence.
        runtime.preloadAssetCoarseBaseline({
          videoPath,
          duration: asset.duration ?? 0,
        });

        // Yield between clips so the Rust side processes requests in batches.
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
    } catch {
      // Non-fatal — the filmstrip will decode on demand as before.
    }
  }

  private async _prewarmNativeRasterAssets(options: {
    startIndex?: number;
    limit?: number;
    yieldBetweenBoundaries?: boolean;
    activeAtTime?: number;
  } = {}): Promise<boolean> {
    // Project open, timeline edits, and the idle queue can all request a
    // prewarm. Native asset upload is backed by one GPU session mutex, so
    // overlapping walks only add contention and duplicate canvas work.
    if (this._nativeRasterPrewarmInFlight) {
      return this._nativeRasterPrewarmInFlight;
    }
    const operation = this._prewarmNativeRasterAssetsInternal(options);
    this._nativeRasterPrewarmInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this._nativeRasterPrewarmInFlight === operation) {
        this._nativeRasterPrewarmInFlight = null;
      }
    }
  }

  private async _prewarmNativeRasterAssetsInternal(options: {
    startIndex?: number;
    limit?: number;
    yieldBetweenBoundaries?: boolean;
    activeAtTime?: number;
  }): Promise<boolean> {
    const bridge = this._nativeRasterBridge;
    if (!bridge || typeof document === "undefined") return false;

    const [projectStore, timelineStore, evaluator, fontRegistry] =
      await Promise.all([
        import("@/store/projectStore"),
        import("@/store/timelineStore"),
        import("@/core/evaluation/evaluator"),
        import("@/core/fonts/nativeFontRegistry"),
      ]);
    const project = projectStore.useProjectStore.getState().project;
    if (!project || project.id !== this.projectId) return false;

    const { clips, tracks, transitions } =
      timelineStore.useTimelineStore.getState();
    const mediaAssets = projectStore.useProjectStore.getState().mediaAssets;
    const assetMap = new Map(mediaAssets.map((a) => [a.id, a]));
    const isRasterClip = (clip: (typeof clips)[number]) => {
      if (
        clip.kind === "text" ||
        clip.kind === "text-template" ||
        clip.kind === "image" ||
        clip.kind === "sticker"
      )
        return true;
      const asset = assetMap.get(clip.mediaId);
      return (
        asset?.type === "image" ||
        (clip.mediaId && clip.mediaId.startsWith("sticker-"))
      );
    };
    const allRasterBoundaries = clips
      .filter(isRasterClip)
      .sort((left, right) => left.startTime - right.startTime);
    if (allRasterBoundaries.length === 0) {
      this._lastCriticalRasterWarmedCount = 0;
      return false;
    }

    let rasterBoundaries = allRasterBoundaries;
    if (options.activeAtTime !== undefined) {
      const t = options.activeAtTime;
      rasterBoundaries = allRasterBoundaries.filter(
        (clip) => clip.startTime <= t && clip.startTime + clip.duration > t,
      );
      if (rasterBoundaries.length === 0) {
        // No raster clips are visible at the initial playhead position.
        // Return true so deferred idle prewarm warms allRasterBoundaries from index 0.
        this._lastCriticalRasterWarmedCount = 0;
        return allRasterBoundaries.length > 0;
      }
    }

    const startIndex = Math.max(0, options.startIndex ?? 0);
    const boundarySlice = rasterBoundaries.slice(
      startIndex,
      options.limit === undefined ? undefined : startIndex + options.limit,
    );
    if (boundarySlice.length === 0) {
      if (options.activeAtTime !== undefined) {
        this._lastCriticalRasterWarmedCount = 0;
        return allRasterBoundaries.length > 0;
      }
      return false;
    }

    if (options.activeAtTime !== undefined) {
      this._lastCriticalRasterWarmedCount = boundarySlice.length;
    }

    const frameRate = Math.max(1, project.frameRate ?? 30);
    for (const clip of boundarySlice) {
      if (this._state === "disposed" || this._state === "disposing") break;
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
      const imageLayers = scene.visualLayers.filter(
        (layer) =>
          layer.layerType === "media" &&
          layer.mediaType === "image" &&
          layer.stickerFormat !== "gif" &&
          layer.stickerFormat !== "lottie",
      );
      if (textLayers.length === 0 && imageLayers.length === 0) continue;

      const warmup = Promise.all([
        textLayers.length > 0
          ? bridge.prewarmTextAssets(scene, "session-prewarm")
          : Promise.resolve(),
        textLayers.length > 0
          ? fontRegistry.ensureNativeFontsRegistered(
              textLayers.map((layer) => layer.fontFamily),
            )
          : Promise.resolve(),
        imageLayers.length > 0
          ? bridge.prewarmImageAssets(scene)
          : Promise.resolve(),
      ]).catch((error) => {
        console.warn("[ProjectSession] Native raster prewarm failed", {
          projectId: this.projectId,
          frameTime,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      await warmup;
      if (options.yieldBetweenBoundaries) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if (options.activeAtTime !== undefined) {
      return allRasterBoundaries.length > boundarySlice.length;
    }
    return startIndex + boundarySlice.length < rasterBoundaries.length;
  }

  private _deferredNativeRasterStartIndex: number | null = null;

  private _scheduleDeferredProjectFontPrewarm(): void {
    if (this._fontIdlePrewarmTimer !== null) return;
    this._fontIdlePrewarmTimer = setTimeout(() => {
      this._fontIdlePrewarmTimer = null;
      if (this._state !== "active") return;
      void this._measureInitializationStage("fonts", () =>
        this._prewarmProjectFonts(),
      ).catch((error) => {
        console.warn("[ProjectSession] Deferred font prewarm failed", {
          projectId: this.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 250);
  }

  private _scheduleDeferredNativeRasterPrewarm(startIndex: number): void {
    this._deferredNativeRasterStartIndex = startIndex;
  }

  private _startDeferredNativeRasterPrewarm(): void {
    const startIndex = this._deferredNativeRasterStartIndex;
    if (startIndex === null || this._nativeRasterIdlePrewarmTimer !== null) {
      return;
    }
    this._nativeRasterIdlePrewarmTimer = setTimeout(() => {
      this._nativeRasterIdlePrewarmTimer = null;
      if (this._state !== "active") return;
      void this._measureInitializationStage("native-raster-deferred", () =>
        this._prewarmNativeRasterAssets({
          startIndex,
          yieldBetweenBoundaries: true,
        }),
      ).catch((error) => {
        console.warn("[ProjectSession] Deferred native raster prewarm failed", {
          projectId: this.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 250);
  }

  /**
   * Schedules idle-priority VideoToolbox decoder warm-up for every stacked
   * video boundary in the timeline. Runs at +500 ms after project open so
   * that it does not compete with the critical-path decoder and IPC activity.
   *
   * Without this, the first user seek into a 2-video stacked region cold-opens
   * the secondary decoder (VTDecompressionSession alloc + keyframe seek),
   * causing a ~350 ms `decode-duration-spike`. With warm-up, the decoder is
   * already initialized so the seek resolves in < 30 ms.
   *
   * Session J telemetry: `peakActorWaitUs = 352,869 µs` diagnosed as
   * `decode-duration-spike + actor-thread-contention + ipc-frame-transfer-stall`
   * at ts=1795166445849 and ts=1795166463615.
   */
  private _scheduleStackedBoundaryDecodeWarmup(): void {
    this._stackedBoundaryWarmupTimer = setTimeout(() => {
      this._stackedBoundaryWarmupTimer = null;
      if (this._state !== "active") return;
      void this._warmStackedVideoBoundaries();
    }, 500);
  }

  private async _warmStackedVideoBoundaries(): Promise<void> {
    if (this._state !== "active") return;

    const projectStore = await import("@/store/projectStore");
    const timelineStore = await import("@/store/timelineStore");
    const project = projectStore.useProjectStore.getState().project;
    if (!project || project.id !== this.projectId) return;

    const { clips, tracks } = timelineStore.useTimelineStore.getState();
    const assets = projectStore.useProjectStore.getState().mediaAssets;

    // Build set of video-track IDs (tracks whose media is video).
    const videoTrackIds = new Set(
      tracks.filter((t) => t.type === "video").map((t) => t.id),
    );

    // Identify clips on video tracks that have a resolved media path.
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const videoClips = clips.filter(
      (c) =>
        videoTrackIds.has(c.trackId) &&
        Boolean(assetMap.get(c.mediaId)?.path),
    );

    // Find clips whose start boundary overlaps with another video clip —
    // these are the stacked-entry boundaries that cold-open secondary decoders.
    const stackedBoundaries: Array<{
      clipId: string;
      startTime: number;
      mediaPath: string;
    }> = [];
    for (const clip of videoClips) {
      const mediaPath = assetMap.get(clip.mediaId)?.path;
      if (!mediaPath) continue;
      const isStacked = videoClips.some(
        (other) =>
          other.id !== clip.id &&
          other.startTime < clip.startTime + clip.duration &&
          other.startTime + other.duration > clip.startTime,
      );
      if (isStacked) {
        stackedBoundaries.push({
          clipId: clip.id,
          startTime: clip.startTime,
          mediaPath,
        });
      }
    }

    if (stackedBoundaries.length === 0) return;

    // Warm each stacked boundary at idle priority, one at a time, yielding
    // between calls so the main thread stays responsive.
    const { invoke } = await import("@tauri-apps/api/core");
    const { prewarmDecoders } = await import("@/lib/platform/tauri");

    // 1. Prime the persistent preview decoder pool
    const pathsToWarm = stackedBoundaries.flatMap((b) => [
      `${b.mediaPath}::stream::${b.clipId}`,
      b.mediaPath,
    ]);
    void prewarmDecoders(Array.from(new Set(pathsToWarm)));

    // 2. Perform background keyframe seek at the boundary PTS
    for (const { clipId, startTime, mediaPath } of stackedBoundaries) {
      if (this._state !== "active") break;
      try {
        await invoke("warm_video_decoder_at_pts", {
          path: mediaPath,
          streamId: clipId,
          targetPts: startTime,
          priority: "idle",
        });
      } catch {
        // Non-fatal: decoder warmup is best-effort. If the command fails
        // or degrades gracefully, silently continue.
      }
      // Yield one macrotask between warmups to avoid starving the event loop.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  private async _prewarmAudioAssets(): Promise<void> {
    const projectStore = await import("@/store/projectStore");
    const timelineStore = await import("@/store/timelineStore");
    const project = projectStore.useProjectStore.getState().project;
    if (!project || project.id !== this.projectId) return;

    const { clips, tracks } = timelineStore.useTimelineStore.getState();
    const audioTrackIds = new Set(
      tracks
        .filter((track) => track.type === "audio" && !track.muted)
        .map((track) => track.id),
    );
    const assets = projectStore.useProjectStore.getState().mediaAssets;
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const items = clips
      .filter((clip) => audioTrackIds.has(clip.trackId))
      .map((clip) => {
        const key = clip.mediaId || clip.audioPath || clip.id;
        const source =
          clip.audioPath ||
          (clip.mediaId ? assetsById.get(clip.mediaId)?.path : undefined);
        return source ? { key, source } : null;
      })
      .filter((item): item is { key: string; source: string } => Boolean(item));

    if (items.length === 0) return;
    const result = await prewarmSharedAudioBuffers(items);
    if (result.failed > 0) {
      console.warn("[ProjectSession] Audio prewarm completed with failures", {
        projectId: this.projectId,
        requested: result.requested,
        loaded: result.loaded,
        failed: result.failed,
      });
    }
  }

  /**
   * Computes the synchronous prewarm window in seconds, scaled inversely by
   * the number of video tracks containing audio. For multi-track projects the
   * per-track decode cost multiplies linearly; scaling the window keeps total
   * wall-time bounded at ~PREWARM_WINDOW_MAX_SECONDS / trackCount seconds.
   *
   * Session J telemetry reference:
   *   1 video track → 90 s window → ~450 ms
   *   2 video tracks → 45 s window → ~460 ms (parallel decode via semaphore)
   *   2 video tracks → 30 s window → ~300 ms ← target
   *
   * The background hydration task picks up everything beyond this window.
   */
  private _computePrewarmWindowSeconds(videoTrackCount: number): number {
    // Scale inversely: 1 track → 90 s, 2 tracks → 45 s, 3+ → 30 s floor.
    const scaled = Math.round(
      ProjectSession.PREWARM_WINDOW_MAX_SECONDS / Math.max(1, videoTrackCount),
    );
    return Math.max(ProjectSession.PREWARM_WINDOW_BASE_SECONDS, scaled);
  }

  private async _prewarmNativeAudioGraph(): Promise<void> {
    const projectStore = await import("@/store/projectStore");
    const timelineStore = await import("@/store/timelineStore");
    const project = projectStore.useProjectStore.getState().project;
    if (!project || project.id !== this.projectId) return;

    const { clips, tracks } = timelineStore.useTimelineStore.getState();
    const assets = projectStore.useProjectStore.getState().mediaAssets;
    const { syncNativeAudioTimeline } = await import(
      "@/core/audio/nativeAudioTimeline"
    );
    const { configureNativePlayback } = await import("@/lib/platform/tauri");
    const { NATIVE_CORE_CONTRACT_VERSION } = await import(
      "@/lib/platform/nativeCore"
    );

    const timelineDuration = clips.reduce(
      (max, clip) => Math.max(max, clip.startTime + clip.duration),
      0,
    );
    const frameRate = Math.max(1, Math.round(project.frameRate || 30));
    const durationFrames = Math.max(1, Math.ceil(timelineDuration * frameRate));
    const audioTrackCount = tracks.filter((t) => t.type === "audio").length;

    // ── Phase 1: Synchronous prewarm — only the initial window ──────────────
    // Scale the window inversely by video track count so total wall-time stays
    // bounded: 1 video track → 90 s, 2 tracks → 45 s, 3+ tracks → 30 s floor.
    // For multi-track projects (like 2× HEVC stacked) this halves prewarm cost
    // from ~912 ms to ~300 ms. The remainder is hydrated off the critical path
    // by _scheduleBackgroundAudioHydration. Session J telemetry: 2-track 90 s
    // window cost 912 ms; 30 s window projects to ~300 ms (−67%).
    const videoTrackCount = tracks.filter(
      (t) => t.type === "video",
    ).length || 1;
    const prewarmWindowEnd = Math.min(
      timelineDuration,
      this._computePrewarmWindowSeconds(videoTrackCount),
    );

    const tPrewarmStart = performance.now();
    let tSyncEnd = tPrewarmStart;
    let prewarmOk = false;

    try {
      // ── IPC span 1: syncNativeAudioTimeline (audio decode + CPAL install) ──
      await syncNativeAudioTimeline(
        clips,
        tracks,
        assets,
        0,
        prewarmWindowEnd,
      );
      tSyncEnd = performance.now();

      // ── IPC span 2: configureNativePlayback (session plan + pipeline warmup) ──
      const tConfigureStart = performance.now();
      await configureNativePlayback({
        contractVersion: NATIVE_CORE_CONTRACT_VERSION,
        projectRevision: `${project.id}:init`,
        frameRate,
        durationFrames,
        audioTrackCount,
      });
      const tConfigureEnd = performance.now();

      prewarmOk = true;

      // ── Telemetry: emit cold-start spans (once per process lifetime) ──
      if (
        !_hasRecordedAudioPrewarm &&
        typeof window !== "undefined" &&
        (window as any).__clypraProjectOpenRequestedWallMs
      ) {
        _hasRecordedAudioPrewarm = true;
        const { recordColdStartSpan } = await import("@/lib/platform/tauri");

        performance.mark("clypra:audio_prewarm_sync_complete");

        // Sub-span A — syncNativeAudioTimeline IPC duration
        void recordColdStartSpan(
          "s2_audio_prewarm_sync_timeline",
          Math.round(tPrewarmStart * 1000),
          Math.round((tSyncEnd - tPrewarmStart) * 1000),
          0,
          false,
          true,
          "audio",
        );

        // Sub-span B — configureNativePlayback IPC duration
        void recordColdStartSpan(
          "s2_audio_prewarm_configure_playback",
          Math.round(tConfigureStart * 1000),
          Math.round((tConfigureEnd - tConfigureStart) * 1000),
          0,
          false,
          true,
          "audio",
        );

        // Aggregate span — total prewarm stage (both IPCs end-to-end)
        void recordColdStartSpan(
          "s2_audio_prewarm_total",
          Math.round(tPrewarmStart * 1000),
          Math.round((tConfigureEnd - tPrewarmStart) * 1000),
          0,
          false,
          true,
          "audio",
        );

        // Post-IPC tail span — time spent inside this method after both IPCs
        // complete (dynamic imports, recordColdStartSpan overhead). Comparing
        // this against the s2_session_audio-prewarm stage wrapper duration
        // reveals whether unexplained time is inside or above this method.
        const tMethodEnd = performance.now();
        void recordColdStartSpan(
          "s2_audio_prewarm_post_ipc_tail",
          Math.round(tConfigureEnd * 1000),
          Math.round((tMethodEnd - tConfigureEnd) * 1000),
          0,
          false,
          true,
          "audio",
        );
      }

      // ── Phase 2: Background audio hydration for the rest of the timeline ──
      // Phase 1 decoded [0, prewarmWindowEnd]. If the timeline is longer, kick
      // off a background task to decode the remainder. Already-decoded clips
      // are returned from the PCM cache (O(1)); only new clip segments decode.
      if (timelineDuration > prewarmWindowEnd) {
        this._scheduleBackgroundAudioHydration(
          clips,
          tracks,
          assets,
          timelineDuration,
        );
      }
    } catch (error) {
      console.warn("[ProjectSession] Native audio prewarm warning:", error);

      // Partial telemetry: record whatever completed before the failure so
      // analysis can identify which IPC is the bottleneck.
      if (
        !_hasRecordedAudioPrewarm &&
        typeof window !== "undefined" &&
        (window as any).__clypraProjectOpenRequestedWallMs
      ) {
        _hasRecordedAudioPrewarm = true;
        const { recordColdStartSpan } = await import("@/lib/platform/tauri");
        const tErrorAt = performance.now();

        // If sync completed before failure, record it.
        if (tSyncEnd > tPrewarmStart) {
          void recordColdStartSpan(
            "s2_audio_prewarm_sync_timeline",
            Math.round(tPrewarmStart * 1000),
            Math.round((tSyncEnd - tPrewarmStart) * 1000),
            0,
            false,
            true,
            "audio",
          );
        }

        // Total span — marked with error flag via console but duration still
        // gives us the wall-clock cost up to failure.
        void recordColdStartSpan(
          "s2_audio_prewarm_total",
          Math.round(tPrewarmStart * 1000),
          Math.round((tErrorAt - tPrewarmStart) * 1000),
          1, // errorCount=1
          false,
          true,
          "audio",
        );
      }

      void prewarmOk; // suppress unused-variable lint
    }
  }

  /**
   * Schedules asynchronous background audio hydration for timeline regions
   * beyond the initial prewarm window.
   *
   * Phase 1 (`_prewarmNativeAudioGraph`) decoded [0, prewarmWindowEnd] (scaled
   * by video track count via `_computePrewarmWindowSeconds`),
   * allowing the project to become interactive immediately. This method decodes
   * the remainder in the background after the UI has painted. Already-decoded
   * clip segments hit the Rust PCM cache (O(1)); only new regions incur FFmpeg
   * decode cost.
   *
   * The task is registered with `_asyncTasks` for clean cancellation on
   * session dispose.
   */
  private _scheduleBackgroundAudioHydration(
    clips: import("@/types").Clip[],
    tracks: import("@/types").Track[],
    assets: import("@/types").MediaAsset[],
    timelineDuration: number,
  ): void {
    // Cancel any stale background hydration from a previous open.
    this._bgAudioHydrationController?.abort();
    const ctrl = new AbortController();
    this._bgAudioHydrationController = ctrl;
    this.registerAsyncTask(ctrl);

    void (async () => {
      try {
        // Yield one macrotask so the main-thread UI can paint first.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (ctrl.signal.aborted) return;

        const tBgStart = performance.now();
        const { recordColdStartSpan } = await import("@/lib/platform/tauri");

        void recordColdStartSpan(
          "s2_audio_prewarm_background_start",
          Math.round(tBgStart * 1000),
          0,
          0,
          false,
          false,
          "audio",
        );

        if (ctrl.signal.aborted) return;

        const { syncNativeAudioTimeline } = await import(
          "@/core/audio/nativeAudioTimeline"
        );

        // Pass startTime=0 so Phase 1 clips are PCM-cache hits; only the
        // newly-windowed segments incur real FFmpeg decode cost.
        await syncNativeAudioTimeline(clips, tracks, assets, 0, timelineDuration);

        if (ctrl.signal.aborted) return;

        const tBgEnd = performance.now();
        void recordColdStartSpan(
          "s2_audio_prewarm_background_complete",
          Math.round(tBgStart * 1000),
          Math.round((tBgEnd - tBgStart) * 1000),
          0,
          false,
          false,
          "audio",
        );
      } catch (err) {
        if (!ctrl.signal.aborted) {
          console.warn(
            "[ProjectSession] Background audio hydration failed:",
            err,
          );
        }
      } finally {
        this.unregisterAsyncTask(ctrl);
      }
    })();
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

  private _notifyListeners(event: {
    type: SessionEventType;
    session: ProjectSession;
    error?: Error;
  }): void {
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
    disposalTimingsMs: Readonly<SessionCloseTimings>;
  } {
    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      state: this._state,
      playbackState: this._playback?.state ?? null,
      pendingJobs: 0,
      videoElements: this._previewMediaPool
        ? this._previewMediaPool.getVideoElements().size
        : 0,
      asyncTasks: this._asyncTasks.size,
      rafLoops: this._rafIds.size,
      disposalTimingsMs: this.disposalTimingsMs,
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
      console.warn(
        `[SessionRegistry] Session switch discarded: session project ${session.projectId} does not match target project ${this._targetProjectId}. Disposing session.`,
      );
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
      console.warn(
        `[SessionRegistry] Session switch superceded (request ${requestId} vs current ${this._currentRequestId}). Disposing orphaned session.`,
      );
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
        console.error(
          `[ProjectSession] Session registry listener error:`,
          error,
        );
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
    throw new Error(
      `[ProjectSession] No active session. Create and initialize a session first.`,
    );
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
    (window as any).__clypra_diagnostics = {
      ...diag,
      lifecycle: lifecycleMonitor,
    };
  }

  const projectLoadStartedAt = performance.now();
  lifecycleMonitor.record("PROJECT_LOAD_START", { projectId });

  sessionRegistry.setTargetProjectId(projectId);

  const session = new ProjectSession(projectId, options.onProgress);
  try {
    await session.initialize();
  } catch (err) {
    lifecycleMonitor.record("PROJECT_LOAD_FAILED", {
      projectId,
      sessionId: session.sessionId,
      detail: {
        durationMs: Math.round(
          Math.max(0, performance.now() - projectLoadStartedAt),
        ),
      },
    });
    if (sessionRegistry.getTargetProjectId() === projectId) {
      sessionRegistry.setTargetProjectId(null);
    }
    throw err;
  }
  await sessionRegistry.setActiveSession(session);

  const loadDurationMs = Math.max(0, performance.now() - projectLoadStartedAt);
  const detail = {
    durationMs: Math.round(loadDurationMs),
    stagesMs: session.initializationTimingsMs,
  };
  lifecycleMonitor.record("PROJECT_LOAD_COMPLETE", {
    projectId,
    sessionId: session.sessionId,
    detail,
  });
  perfLogService.enqueue({
    kind: "project-session-load",
    sessionId: session.sessionId,
    timestampEpochMs: Date.now(),
    payload: { stage: "complete", ...detail },
  });

  return session;
}

/**
 * Dispose active project session.
 */
export async function disposeActiveSession(): Promise<void> {
  sessionRegistry.setTargetProjectId(null);
  await sessionRegistry.clearActiveSession();
}
