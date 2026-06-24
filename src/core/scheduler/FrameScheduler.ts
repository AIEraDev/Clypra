/**
 * Frame Scheduler
 *
 * Orchestrates temporal rendering with proper cancellation,
 * priority scheduling, and resource management.
 *
 * Architecture:
 *   FrameRequest → Scheduler → Evaluation → Rasterization → Output
 *
 * Key principles:
 * - Cancellation propagates through entire pipeline
 * - Priority-based scheduling (realtime > export > background)
 * - Resource pre-loading for batch operations
 * - Progress tracking and telemetry
 */

import type { FrameRequest, FrameResult, RenderResourceHandle } from "../resources/types";
import type { Clip, Track, MediaAsset, Project, TransitionTimelineItem } from "@/types";
import { evaluateTimelineSceneCached } from "../evaluation/evaluator";
import { rasterizeScene } from "../render/rasterizer";
import { getResourceCache } from "../resources/ResourceCache";
import { getFontLoader } from "../fonts/FontLoader";
import { textRenderTrace } from "@/lib/debug/textRenderTrace";
import { performanceMonitor } from "@/lib/debug/performanceMonitor";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Frame job status.
 */
export type FrameJobStatus = "pending" | "loading" | "evaluating" | "rasterizing" | "complete" | "cancelled" | "failed";

/**
 * Frame job.
 * Represents a single frame render request with lifecycle tracking.
 */
export interface FrameJob {
  /** Unique job ID */
  id: string;

  /** Project ID - for validating job belongs to current project (FIX-004) */
  projectId: string;

  /** Frame request */
  request: FrameRequest;

  /** Current status */
  status: FrameJobStatus;

  /** Progress (0-1) */
  progress: number;

  /** Result (when complete) */
  result?: FrameResult;

  /** Error (when failed) */
  error?: Error;

  /** Cancellation token */
  cancelled: boolean;

  /** AbortController for async pipeline cancellation */
  abortController: AbortController;

  /** Timestamps */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  /** Telemetry */
  metrics: {
    evaluationTimeMs?: number;
    rasterTimeMs?: number;
    resourceLoadTimeMs?: number;
    totalTimeMs?: number;
  };

  /** Resource handles acquired during preload (for release after rasterization) */
  acquiredResourceHandles: RenderResourceHandle[];
}

/**
 * Scheduler configuration.
 */
export interface SchedulerConfig {
  /** Maximum concurrent jobs */
  maxConcurrent?: number;

  /** Enable telemetry */
  enableTelemetry?: boolean;

  /** Debug logging */
  debug?: boolean;
}

/**
 * Scheduler statistics.
 */
export interface SchedulerStats {
  /** Total jobs processed */
  totalJobs: number;

  /** Jobs by status */
  pending: number;
  active: number;
  complete: number;
  cancelled: number;
  failed: number;

  /** Average times */
  avgEvaluationTimeMs: number;
  avgRasterTimeMs: number;
  avgTotalTimeMs: number;

  /** Cache hit rate */
  cacheHitRate: number;
}

/**
 * Frame scheduler.
 * Orchestrates frame rendering with proper lifecycle management.
 */
export class FrameScheduler {
  private jobs = new Map<string, FrameJob>();
  private queue: FrameJob[] = [];
  private activeJobs = new Set<string>();
  private config: Required<SchedulerConfig>;
  private nextJobId = 0;

  // Timeline state (for evaluation)
  private clips: Clip[] = [];
  private tracks: Track[] = [];
  private assets: MediaAsset[] = [];
  private transitions: TransitionTimelineItem[] = [];
  private project: Project | null = null;
  private epoch: number = 0;

  // Persistent resource handle cache (survives frame evaluations)
  // Maps sourcePath → RenderResourceHandle to avoid O(n) getHandleForUrl() searches
  private persistentResourceHandles = new Map<string, RenderResourceHandle>();

  // Telemetry
  private stats = {
    totalJobs: 0,
    completedJobs: 0,
    cancelledJobs: 0,
    failedJobs: 0,
    totalEvaluationTimeMs: 0,
    totalRasterTimeMs: 0,
    totalTimeMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(config: SchedulerConfig = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 4,
      enableTelemetry: config.enableTelemetry ?? true,
      debug: config.debug ?? false,
    };
  }

  /**
   * Update timeline state.
   * Must be called before scheduling frames.
   */
  updateTimeline(clips: Clip[], tracks: Track[], assets: MediaAsset[], project: Project | null, epoch: number, transitions: TransitionTimelineItem[] = []): void {
    // Clean up orphaned resource handles when epoch changes (clips deleted/modified)
    const epochDelta = epoch - this.epoch;
    if (epochDelta > 0 && this.persistentResourceHandles.size > 0) {
      this.cleanupOrphanedResourceHandles(clips, assets);
    }

    this.clips = clips;
    this.tracks = tracks;
    this.assets = assets;
    this.transitions = transitions;
    this.project = project;
    this.epoch = epoch;
  }

  /**
   * Schedule a frame render request.
   *
   * @param request - Frame request
   * @returns Job ID
   */
  schedule(request: FrameRequest): string {
    // ✅ FIX-004: Capture current project ID synchronously via globalThis
    // SessionRegistry already sets __activeProjectSession on globalThis
    let projectId = "unknown";
    try {
      const session = (globalThis as any).__activeProjectSession;
      if (session?.projectId) {
        projectId = session.projectId;
      }
    } catch {
      // If we can't get session, use "unknown"
      // Validation in wait() will handle this gracefully
    }

    const job: FrameJob = {
      id: `job-${this.nextJobId++}`,
      projectId, // ✅ FIX-004: Store project ID with job for validation
      request,
      status: "pending",
      progress: 0,
      cancelled: false,
      abortController: new AbortController(),
      createdAt: Date.now(),
      metrics: {},
      acquiredResourceHandles: [],
    };

    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.stats.totalJobs++;

    // Sort queue by priority
    this.sortQueue();

    // Process queue
    this.processQueue();

    return job.id;
  }

  /**
   * Cancel a job.
   *
   * @param jobId - Job ID
   */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && !job.cancelled) {
      job.cancelled = true;
      job.status = "cancelled";
      job.abortController.abort();
      this.stats.cancelledJobs++;
    }
  }

  /**
   * Cancel all jobs.
   */
  cancelAll(): void {
    for (const job of this.jobs.values()) {
      if (!job.cancelled && job.status !== "complete") {
        this.cancel(job.id);
      }
    }
  }

  /**
   * Get job status.
   *
   * @param jobId - Job ID
   * @returns Job or null
   */
  getJob(jobId: string): FrameJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Wait for job completion.
   *
   * @param jobId - Job ID
   * @returns Frame result
   */
  async wait(jobId: string): Promise<FrameResult> {
    return new Promise((resolve, reject) => {
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const checkJob = () => {
        const job = this.jobs.get(jobId);
        if (!job) {
          reject(new Error(`Job ${jobId} not found`));
          return;
        }

        if (job.status === "complete" && job.result) {
          // ✅ FIX-004: Validate job belongs to current project before resolving
          // This prevents stale frames from previous project being displayed
          const session = (globalThis as any).__activeProjectSession;
          const currentProjectId = session?.projectId ?? "unknown";

          if (currentProjectId !== job.projectId) {
            // Project switched - discard stale result
            if (this.config.debug) {
              console.log(`[Scheduler] Discarding stale job ${jobId} from project ${job.projectId} (current: ${currentProjectId})`);
            }
            reject(new Error("Job result discarded - project switched"));
            return;
          }
          resolve(job.result!);
        } else if (job.status === "cancelled") {
          if (timerId !== null) clearTimeout(timerId);
          reject(new Error("Job cancelled"));
        } else if (job.status === "failed") {
          if (timerId !== null) clearTimeout(timerId);
          reject(job.error || new Error("Job failed"));
        } else {
          // Check again in 16ms (~60fps)
          timerId = setTimeout(checkJob, 16);
        }
      };

      checkJob();
    });
  }

  /**
   * Get scheduler statistics.
   */
  getStats(): SchedulerStats {
    const pending = Array.from(this.jobs.values()).filter((j) => j.status === "pending").length;
    const active = this.activeJobs.size;
    const complete = this.stats.completedJobs;
    const cancelled = this.stats.cancelledJobs;
    const failed = this.stats.failedJobs;

    const avgEvaluationTimeMs = complete > 0 ? this.stats.totalEvaluationTimeMs / complete : 0;
    const avgRasterTimeMs = complete > 0 ? this.stats.totalRasterTimeMs / complete : 0;
    const avgTotalTimeMs = complete > 0 ? this.stats.totalTimeMs / complete : 0;

    const totalCacheOps = this.stats.cacheHits + this.stats.cacheMisses;
    const cacheHitRate = totalCacheOps > 0 ? this.stats.cacheHits / totalCacheOps : 0;

    return {
      totalJobs: this.stats.totalJobs,
      pending,
      active,
      complete,
      cancelled,
      failed,
      avgEvaluationTimeMs,
      avgRasterTimeMs,
      avgTotalTimeMs,
      cacheHitRate,
    };
  }

  /**
   * Clear completed jobs.
   */
  clearCompleted(): void {
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === "complete" || job.status === "cancelled" || job.status === "failed") {
        this.jobs.delete(id);
      }
    }
  }

  /**
   * Dispose scheduler and release all resources.
   * Cancels all pending jobs and clears state.
   */
  dispose(): void {
    // Cancel all jobs
    this.cancelAll();

    // Clear all state
    this.jobs.clear();
    this.queue = [];
    this.activeJobs.clear();

    // Reset timeline state
    this.clips = [];
    this.tracks = [];
    this.assets = [];
    this.project = null;
    this.epoch = 0;

    // Reset telemetry
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      cancelledJobs: 0,
      failedJobs: 0,
      totalEvaluationTimeMs: 0,
      totalRasterTimeMs: 0,
      totalTimeMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Sort queue by priority.
   */
  private sortQueue(): void {
    const priorityOrder = { realtime: 0, export: 1, background: 2 };

    this.queue.sort((a, b) => {
      const aPriority = priorityOrder[a.request.priority ?? "background"];
      const bPriority = priorityOrder[b.request.priority ?? "background"];

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Same priority: FIFO
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Process queue.
   */
  private processQueue(): void {
    // Process jobs up to max concurrent
    while (this.activeJobs.size < this.config.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (job && !job.cancelled) {
        this.processJob(job);
      }
    }
  }

  /**
   * Process a single job.
   */
  private async processJob(job: FrameJob): Promise<void> {
    // performanceMonitor.startMeasure(`frame-${job.id}`, {
    //   time: job.request.time,
    //   priority: job.request.priority,
    // });

    this.activeJobs.add(job.id);
    job.startedAt = Date.now();

    try {
      // ✅ Check before each phase
      this.throwIfCancelled(job);

      // Step 1: Resource loading
      job.status = "loading";
      job.progress = 0.1;
      // performanceMonitor.startMeasure(`resource-load-${job.id}`);
      const resourceStartTime = Date.now();

      // Pre-load resources for this frame (tracks acquired handles on the job)
      await this.preloadResources(job);

      // Pre-load fonts for text layers
      await this.preloadFonts(job);

      job.metrics.resourceLoadTimeMs = Date.now() - resourceStartTime;
      // performanceMonitor.endMeasure(`resource-load-${job.id}`, {
      //   duration: job.metrics.resourceLoadTimeMs,
      // });

      // ✅ Check after async operations
      this.throwIfCancelled(job);

      // Step 2: Evaluation
      job.status = "evaluating";
      job.progress = 0.3;
      // performanceMonitor.startMeasure(`evaluation-${job.id}`);
      const evalStartTime = Date.now();

      const scene = evaluateTimelineSceneCached(job.request.time, this.clips, this.tracks, this.assets, this.project, this.epoch, this.transitions);

      // ✅ Only construct trace payload if debug is enabled (prevents console spam in production)
      if (import.meta.env.DEV) {
        const textLayers = scene.visualLayers.filter((layer) => layer.layerType === "text");
        textRenderTrace("frame-scene", {
          jobId: job.id,
          time: job.request.time,
          epoch: this.epoch,
          visualLayerCount: scene.visualLayers.length,
          textLayerCount: textLayers.length,
          textLayers: textLayers.map((layer) => ({
            clipId: layer.clipId,
            layerId: layer.layerId,
            text: layer.text,
            styleId: layer.styleId,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            opacity: layer.opacity,
            hasStyleDefinition: !!layer.styleDefinition,
          })),
        });
      }

      job.metrics.evaluationTimeMs = Date.now() - evalStartTime;
      this.stats.totalEvaluationTimeMs += job.metrics.evaluationTimeMs;
      // performanceMonitor.endMeasure(`evaluation-${job.id}`, {
      //   duration: job.metrics.evaluationTimeMs,
      //   layerCount: scene.visualLayers.length,
      // });

      // ✅ Check after sync work
      this.throwIfCancelled(job);

      // Step 3: Rasterization
      job.status = "rasterizing";
      job.progress = 0.6;
      // performanceMonitor.startMeasure(`rasterization-${job.id}`);
      const rasterStartTime = Date.now();

      const rasterFrame = await rasterizeScene(scene, {
        width: job.request.resolution.width,
        height: job.request.resolution.height,
        pixelRatio: job.request.pixelRatio,
        colorSpace: job.request.colorSpace,
        videoElements: job.request.videoElements,
        skipFilters: job.request.skipFilters,
      });

      job.metrics.rasterTimeMs = Date.now() - rasterStartTime;
      this.stats.totalRasterTimeMs += job.metrics.rasterTimeMs;
      // performanceMonitor.endMeasure(`rasterization-${job.id}`, {
      //   duration: job.metrics.rasterTimeMs,
      // });

      // ✅ Check after async operations
      this.throwIfCancelled(job);

      // Step 4: Output conversion
      job.progress = 0.9;

      let outputData: ImageBitmap | ImageData | Blob;

      try {
        switch (job.request.outputFormat) {
          case "imagebitmap":
            if (rasterFrame.canvas instanceof OffscreenCanvas) {
              outputData = await rasterFrame.canvas.transferToImageBitmap();
            } else {
              outputData = await createImageBitmap(rasterFrame.canvas);
            }
            break;

          case "imagedata":
            outputData = rasterFrame.ctx.getImageData(0, 0, job.request.resolution.width, job.request.resolution.height);
            break;

          case "blob":
          default:
            if (rasterFrame.canvas instanceof OffscreenCanvas) {
              outputData = await rasterFrame.canvas.convertToBlob({
                type: "image/png",
                quality: job.request.quality,
              });
            } else {
              outputData = await new Promise<Blob>((resolve, reject) => {
                (rasterFrame.canvas as HTMLCanvasElement).toBlob(
                  (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Failed to create blob"));
                  },
                  "image/png",
                  job.request.quality,
                );
              });
            }
            break;
        }
      } finally {
        // Release canvas back to pool after output conversion
        if (rasterFrame.releaseCanvas) {
          rasterFrame.releaseCanvas();
        }
      }

      // ✅ Check after async operations
      this.throwIfCancelled(job);

      // Complete
      job.completedAt = Date.now();
      job.metrics.totalTimeMs = job.completedAt - job.startedAt;
      this.stats.totalTimeMs += job.metrics.totalTimeMs;

      job.result = {
        request: job.request,
        data: outputData,
        renderTimeMs: job.metrics.totalTimeMs,
        resourcesCached: true, // TODO: Track actual cache hits
      };

      job.status = "complete";
      job.progress = 1.0;
      this.stats.completedJobs++;

      // performanceMonitor.endMeasure(`frame-${job.id}`, {
      //   totalTime: job.metrics.totalTimeMs,
      //   resourceLoad: job.metrics.resourceLoadTimeMs,
      //   evaluation: job.metrics.evaluationTimeMs,
      //   rasterization: job.metrics.rasterTimeMs,
      // });
    } catch (error) {
      // ✅ Distinguish cancellation from failure
      if (error instanceof Error && error.message === "Job cancelled") {
        job.status = "cancelled";
      } else {
        job.status = "failed";
        job.error = error as Error;
        this.stats.failedJobs++;
      }

      if (this.config.debug && job.status === "failed") {
        console.error(`[Scheduler] Job ${job.id} failed:`, error);
      }

      // performanceMonitor.endMeasure(`frame-${job.id}`, {
      //   error: true,
      //   status: job.status,
      // });
    } finally {
      // Release all resource handles acquired during preload
      this.releaseJobResources(job);

      this.activeJobs.delete(job.id);
      this.processQueue(); // Process next job
    }
  }

  /**
   * Check if job is cancelled and throw if so.
   * Centralizes cancellation checking logic.
   */
  private throwIfCancelled(job: FrameJob): void {
    if (job.cancelled || job.abortController.signal.aborted) {
      throw new Error("Job cancelled");
    }
  }

  /**
   * Release all resource handles acquired by a job.
   * Called in the finally block of processJob to ensure cleanup.
   */
  private releaseJobResources(job: FrameJob): void {
    if (job.acquiredResourceHandles.length === 0) return;

    const resourceCache = getResourceCache();
    for (const handle of job.acquiredResourceHandles) {
      resourceCache.release(handle);
    }
    job.acquiredResourceHandles = [];
  }

  /**
   * Remove resource handles for sourcePaths no longer in timeline.
   * Called when epoch changes (clips added/removed/modified).
   * O(n+m) complexity using asset map to avoid nested loops.
   */
  private cleanupOrphanedResourceHandles(clips: Clip[], assets: MediaAsset[]): void {
    // Build asset map once - O(m)
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    // Build set of active sourcePaths - O(n)
    const activeSourcePaths = new Set<string>();
    for (const clip of clips) {
      const asset = assetMap.get(clip.mediaId);
      if (asset) {
        const sourcePath = asset.path.startsWith("asset://") ? asset.path : convertFileSrc(asset.path);
        activeSourcePaths.add(sourcePath);
      }
    }

    // Remove orphaned handles - O(p) where p = persistent cache size
    let removedCount = 0;
    for (const [sourcePath] of Array.from(this.persistentResourceHandles.entries())) {
      if (!activeSourcePaths.has(sourcePath)) {
        this.persistentResourceHandles.delete(sourcePath);
        removedCount++;
      }
    }

    if (this.config.debug && removedCount > 0) {
      console.log(`[FrameScheduler] Cleaned ${removedCount} orphaned resource handle(s)`);
    }
  }

  /**
   * Pre-load resources for a frame.
   * Analyzes the scene and pre-loads all media resources.
   * Tracks acquired handles on the job for release after rasterization.
   */
  private async preloadResources(job: FrameJob): Promise<void> {
    // Evaluate scene to discover required resources
    const scene = evaluateTimelineSceneCached(job.request.time, this.clips, this.tracks, this.assets, this.project, this.epoch, this.transitions);

    const resourceCache = getResourceCache();
    const loadPromises: Promise<void>[] = [];

    // Map to store loaded resource handles for each layer
    const layerResourceHandles = new Map<string, RenderResourceHandle>();

    // Pre-load all media resources
    for (const layer of scene.visualLayers) {
      if (layer.layerType === "media") {
        // Check cancellation before loading
        if (job.cancelled) {
          throw new Error("Job cancelled");
        }

        // If we have an active video element for this layer, bypass resource manager
        if (layer.mediaType === "video" && job.request.videoElements) {
          const key = `${layer.clipId}-${layer.mediaId}`;
          if (job.request.videoElements.has(key)) {
            const video = job.request.videoElements.get(key)!;

            // If the video is currently seeking or hasn't loaded enough data yet, wait for it!
            if (video.seeking || video.readyState < 2) {
              const waitPromise = new Promise<void>((resolve) => {
                let isResolved = false;
                const onReady = () => {
                  if (isResolved) return;
                  isResolved = true;
                  cleanup();
                  resolve();
                };

                const onSeeked = () => {
                  if (typeof (video as any).requestVideoFrameCallback === "function") {
                    (video as any).requestVideoFrameCallback(onReady);
                  } else {
                    requestAnimationFrame(() => requestAnimationFrame(onReady));
                  }
                };

                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const cleanup = () => {
                  if (timeoutId !== null) clearTimeout(timeoutId);
                  video.removeEventListener("seeked", onSeeked);
                  video.removeEventListener("canplay", onReady);
                  video.removeEventListener("error", onReady);
                  job.abortController.signal.removeEventListener("abort", onReady);
                };

                video.addEventListener("seeked", onSeeked, { once: true });
                video.addEventListener("canplay", onReady, { once: true });
                video.addEventListener("error", onReady, { once: true });
                job.abortController.signal.addEventListener("abort", onReady, { once: true });

                // Safety timeout: don't wait forever. If media events don't fire within 500ms,
                // resolve so rasterizer can proceed with available frames (prevents blank frames).
                timeoutId = setTimeout(() => {
                  onReady();
                }, 500);
              });
              loadPromises.push(waitPromise);
            }
            continue; // We will draw directly from the video element
          }
        }

        // Acquire resource (will cache if not already loaded)
        // For images, use "image-bitmap". For videos without elements, use "video-element"
        const type = layer.mediaType === "video" ? "video-element" : "image-bitmap";

        // NEW: Check persistent cache FIRST (O(1) map lookup)
        let cachedHandle = this.persistentResourceHandles.get(layer.sourcePath);

        if (cachedHandle) {
          // Try to increment ref without O(n) search (FAST PATH)
          if (resourceCache.incrementRef(cachedHandle)) {
            // Handle still valid - use it without calling acquire()
            job.acquiredResourceHandles.push(cachedHandle);
            layerResourceHandles.set(layer.layerId, cachedHandle);
            continue; // Skip acquire - avoids O(n) getHandleForUrl() iteration
          } else {
            // Handle was evicted from resource cache - remove from persistent map
            this.persistentResourceHandles.delete(layer.sourcePath);
          }
        }

        // Not in persistent cache or was evicted - acquire new (O(n) search, but only once per sourcePath)
        const loadPromise = Promise.race([
          resourceCache.acquire(layer.sourcePath, type).then((handle) => {
            // Store in persistent cache for next frame
            this.persistentResourceHandles.set(layer.sourcePath, handle);
            // Track acquired handle for release after rasterization
            job.acquiredResourceHandles.push(handle);
            // ✅ FIX: Store the handle so we can attach it to the layer
            layerResourceHandles.set(layer.layerId, handle);
          }),
          new Promise<void>((_, reject) => {
            job.abortController.signal.addEventListener("abort", () => reject(new Error("Job cancelled")), { once: true });
            if (job.abortController.signal.aborted) reject(new Error("Job cancelled"));
          }),
        ]).catch((error) => {
          // Log non-cancellation errors; cancellation is expected
          if (!job.cancelled && this.config.debug) {
            console.warn(`Failed to pre-load resource: ${layer.sourcePath}`, error);
          }
        });

        loadPromises.push(loadPromise);
      }
    }

    // Wait for all resources to load
    await Promise.all(loadPromises);

    // ✅ FIX: Attach resource handles to the layers
    for (const layer of scene.visualLayers) {
      if (layer.layerType === "media") {
        const handle = layerResourceHandles.get(layer.layerId);
        if (handle) {
          // Mutate the layer to add the resource handle
          (layer as any).resourceHandle = handle;
        } else if (layer.mediaType === "image") {
          console.warn(`[FrameScheduler] No handle found for image layer ${layer.clipId} at ${layer.sourcePath}`);
        }
      }
    }
  }

  /**
   * Pre-load fonts for text layers.
   * Ensures deterministic font availability before rendering.
   */
  private async preloadFonts(job: FrameJob): Promise<void> {
    // Evaluate scene to discover required fonts
    const scene = evaluateTimelineSceneCached(job.request.time, this.clips, this.tracks, this.assets, this.project, this.epoch, this.transitions);

    const fontLoader = getFontLoader();
    const fontDescriptors = [];

    // Collect all unique fonts from text layers
    for (const layer of scene.visualLayers) {
      if (layer.layerType === "text") {
        fontDescriptors.push({
          family: layer.fontFamily,
          weight: layer.fontWeight,
          style: layer.fontStyle,
        });
      }
    }

    // Load all fonts
    if (fontDescriptors.length > 0) {
      try {
        await fontLoader.ensureFonts(fontDescriptors);
        await fontLoader.waitForFontsReady();
      } catch (error) {
        // Log but don't fail - rasterizer will use fallback fonts
        if (this.config.debug) {
          console.warn("Failed to pre-load fonts:", error);
        }
      }
    }
  }
}

/**
 * Global frame scheduler instance.
 */
let globalScheduler: FrameScheduler | null = null;

/**
 * Get or create global frame scheduler.
 */
export function getFrameScheduler(): FrameScheduler {
  if (!globalScheduler) {
    globalScheduler = new FrameScheduler();
  }
  return globalScheduler;
}

/**
 * Reset global frame scheduler.
 * Fully disposes the current instance including cancelling all jobs and clearing state.
 */
export function resetFrameScheduler(): void {
  if (globalScheduler) {
    globalScheduler.dispose();
  }
  globalScheduler = null;
}
