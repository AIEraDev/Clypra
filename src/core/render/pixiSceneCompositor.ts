import { getSharedPixiRenderer, getOrCreateMediaSprite, applyMediaTransform, clearAllMediaSprites, ALL_TRANSITIONS } from "@clypra-studio/engine";
import { renderTextLayerBridged, beginTextFrame, endTextFrame } from "./textBridge.js";
import { renderStickerLayerBridged, beginStickerFrame, endStickerFrame } from "./stickerBridge.js";
import type { EvaluatedScene, EvaluatedMediaLayer, EvaluatedTextLayer, EvaluatedTransition } from "../evaluation/types.js";
import { Container, RenderTexture } from "pixi.js";
import { clearFilterCache } from "./filterCache.js";

// Utility imports
import { extractVisualMediaLayers, calculateMaxTrackIndex, calculateLayerZIndex } from "./utils/zIndexCalculator.js";
import { resolveMediaSource } from "./utils/mediaResolver.js";
import { resolveTransitionDefinition, mergeTransitionParams } from "./utils/transitionResolver.js";

// Service and manager imports
import { ConformCaptureService } from "./services/ConformCaptureService.js";
import { FilterManager } from "./managers/FilterManager.js";
import { SpriteLifecycleManager } from "./managers/SpriteLifecycleManager.js";

// Boundary components
import type { PreviewMediaPool } from "../resources/PreviewMediaPool.js";

export class PixiSceneCompositor {
  private renderer: any;
  private currentFrameId = 0;
  private transitionRenderTextures = new Map<"from" | "to", RenderTexture>();
  private transitionOffscreenContainers = new Map<"from" | "to", Container>();
  private transitionLastRenderedTime = new Map<"from" | "to", number>();
  private hadActiveTransition = false;
  private isDestroying = false;
  private canvas: HTMLCanvasElement | null = null;
  private contextLostHandler: ((event: Event) => void) | null = null;
  private contextRestoredHandler: ((event: Event) => void) | null = null;

  // Services and managers for code organization
  private mediaPool: PreviewMediaPool;
  private conformCapture: ConformCaptureService;
  private filterManager: FilterManager;
  private spriteLifecycle: SpriteLifecycleManager;

  constructor(canvas: HTMLCanvasElement, width: number, height: number, mediaPool: PreviewMediaPool) {
    this.canvas = canvas;
    this.renderer = getSharedPixiRenderer(canvas, width, height);

    // Initialize services and managers
    this.mediaPool = mediaPool;
    this.conformCapture = new ConformCaptureService();
    this.filterManager = new FilterManager();
    this.spriteLifecycle = new SpriteLifecycleManager();

    // Handle WebGL context loss
    this.setupContextLossHandlers(canvas);
  }

  get isReady(): boolean {
    return this.renderer?.isReady || false;
  }

  async waitForReady(): Promise<void> {
    while (!this.renderer?.isReady) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private setupContextLossHandlers(canvas: HTMLCanvasElement): void {
    this.contextLostHandler = (event: Event) => {
      event.preventDefault();

      console.warn("[PreviewLifecycle] webgl:context-lost", {
        intentional: this.isDestroying,
        timestamp: performance.now(),
      });

      if (this.isDestroying) {
        // Expected teardown, not an error
        return;
      }

      console.error("[PixiSceneCompositor] Unexpected WebGL context loss");
      // TODO: Add metrics tracking here
      // metrics.increment("preview.webgl_context_lost.unexpected");
    };

    this.contextRestoredHandler = (event: Event) => {
      if (this.isDestroying) {
        return;
      }

      console.log("[PixiSceneCompositor] WebGL context restored");
      // TODO: Add recovery logic here if needed
    };

    canvas.addEventListener("webglcontextlost", this.contextLostHandler);
    canvas.addEventListener("webglcontextrestored", this.contextRestoredHandler);
  }

  /**
   * Resize the compositor without destroying GPU resources.
   * Called when displayWidth/displayHeight changes.
   */
  resize(width: number, height: number, resolution = window.devicePixelRatio): void {
    if (!this.renderer?.resize) {
      console.warn("[PixiSceneCompositor] Cannot resize: renderer not available");
      return;
    }

    try {
      this.renderer.resize(width, height, resolution);

      // Resize transition render textures if they exist
      for (const [key, texture] of this.transitionRenderTextures.entries()) {
        texture.resize(width, height);
      }

      console.log(`[PixiSceneCompositor] Resized to ${width}x${height} @ ${resolution}x DPR`);
    } catch (err) {
      console.error("[PixiSceneCompositor] Resize failed:", err);
    }
  }

  async composeFrame(scene: EvaluatedScene, viewport: { scale: number; offsetX: number; offsetY: number; pixelRatio: number; projectWidth?: number; projectHeight?: number }, videoElements: Map<string, HTMLVideoElement>, resourceHandleMap?: Map<string, any>, bodyMasks: Map<string, any> = new Map()): Promise<void> {
    if (!this.renderer.isReady) {
      return;
    }

    const activeTransition = scene.transitions[0];
    let isTransitionActive = false;
    let transitionLayerIds = new Set<string>();
    let definition: any = null;

    if (activeTransition) {
      const resolved = resolveTransitionDefinition(
        activeTransition.type,
        ALL_TRANSITIONS,
        activeTransition.renderer, // Pass renderer from API transition if available
      );

      if (resolved) {
        definition = resolved.definition;
        isTransitionActive = true;
        transitionLayerIds = new Set([activeTransition.outgoingLayer, activeTransition.incomingLayer]);
      } else {
        console.warn("[Compositor] Unknown transition type, falling back to crossfade:", activeTransition.type);
      }
    }

    // Boundary unmount detection
    if (!isTransitionActive && this.hadActiveTransition) {
      this.renderer.unmountTransition();
      const transitionSprite = this.renderer.getTransitionSprite();
      const app = this.renderer.getApp();
      if (transitionSprite && app) {
        transitionSprite.parent?.removeChild(transitionSprite);
        app.stage.addChildAt(transitionSprite, 2);
      }
      // Clear transition time cache when transition ends
      this.transitionLastRenderedTime.clear();
    }
    this.hadActiveTransition = isTransitionActive;

    // Auto-resize renderer when project dimensions or scale change
    const projectW = viewport.projectWidth || 1920;
    const projectH = viewport.projectHeight || 1080;
    const backingW = Math.round(projectW * viewport.scale);
    const backingH = Math.round(projectH * viewport.scale);
    const app = this.renderer.getApp();
    if (app && (app.screen.width !== backingW || app.screen.height !== backingH)) {
      this.renderer.resize(backingW, backingH);
    }

    this.currentFrameId++;
    const frameId = this.currentFrameId;

    const baseMediaContainer = this.renderer.getOverlayContainer() || this.renderer.getApp()?.stage;
    if (!baseMediaContainer) return;

    // Scale the container to project viewport scale
    baseMediaContainer.scale.set(viewport.scale);
    baseMediaContainer.position.set(0, 0);
    baseMediaContainer.sortableChildren = true;

    // Hide the legacy video sprite to prevent covering the composited layers
    const videoSprite = this.renderer.getVideoSprite();
    if (videoSprite) {
      videoSprite.visible = false;
    }

    // 1. Prepare frame
    beginTextFrame(baseMediaContainer);
    beginStickerFrame(baseMediaContainer);

    const sortedLayers = [...scene.visualLayers];

    // ─── Canonical Visual Stacking Contract ───────────────────────────────────
    // This defines the SINGLE SOURCE OF TRUTH for layer ordering across all renderers:
    // - Pixi preview (this compositor)
    // - Legacy canvas fallback
    // - Export rendering
    // - Thumbnail generation
    //
    // Contract:
    // 1. Lower trackIndex (top in timeline UI) renders LAST → appears ON TOP
    // 2. Within same track, renderOrder (evaluator array index) determines order
    // 3. z-index formula: (maxTrackIndex - trackIndex) * SPACING + renderOrder
    //
    // This ensures:
    // - Track 0 (timeline top) always occludes all other tracks
    // - Overlapping clips on same track follow evaluator sort order
    // - No z-index collisions even with many tracks or clips
    // ──────────────────────────────────────────────────────────────────────────

    // Compute max trackIndex from active visual media layers for robust z-index mapping
    const visualMediaLayers = extractVisualMediaLayers(sortedLayers);
    const maxTrackIndex = calculateMaxTrackIndex(visualMediaLayers);

    for (let index = 0; index < sortedLayers.length; index++) {
      const layer = sortedLayers[index];
      const renderOrder = index;

      if (layer.layerType === "media") {
        const mediaLayer = layer as EvaluatedMediaLayer;

        if (isTransitionActive && transitionLayerIds.has(mediaLayer.layerId)) {
          continue;
        }

        if (mediaLayer.clipKind === "sticker") {
          await renderStickerLayerBridged(mediaLayer, frameId, baseMediaContainer, viewport, renderOrder);
        } else {
          // Use media resolver to get video element or image resource
          const sourceElement = resolveMediaSource(mediaLayer, videoElements, resourceHandleMap);

          if (!sourceElement && mediaLayer.mediaType === "video" && import.meta.env.DEV) {
            const key = `${mediaLayer.clipId}-${mediaLayer.mediaId}`;
            console.warn(`[Clypra Compositor] Active video clip "${mediaLayer.clipId}" has no backing video element (key: ${key}). It will not be rendered.`);
          }

          if (sourceElement) {
            const record = getOrCreateMediaSprite(mediaLayer.clipId, mediaLayer.mediaType, sourceElement, baseMediaContainer);

            // Skip this layer if sprite creation was deferred (video metadata not ready yet)
            if (!record) {
              continue;
            }

            record.lastSeenFrame = frameId;
            record.sprite.visible = true;

            // Update video texture using VideoTextureManager from PreviewMediaPool
            if (mediaLayer.mediaType === "video" && sourceElement instanceof HTMLVideoElement) {
              if (this.mediaPool.shouldUpdateTexture(mediaLayer.clipId, sourceElement)) {
                record.texture.source.update();
                this.mediaPool.markTextureClean(mediaLayer.clipId);
              }
            }

            // Capture video source dimensions using conform capture service
            if (mediaLayer.mediaType === "video" && sourceElement instanceof HTMLVideoElement && mediaLayer.conform) {
              this.conformCapture.captureVideoDimensions(mediaLayer.clipId, sourceElement, mediaLayer.conform);
            }

            applyMediaTransform(record.sprite, mediaLayer, viewport);

            // Apply filters using filter manager
            this.filterManager.applyFilters(record.sprite, mediaLayer, bodyMasks);

            // CRITICAL: Compute z-index from trackIndex for proper NLE stacking
            // Use utility function for consistent z-index calculation across codebase
            const trackIdx = mediaLayer.trackIndex ?? 0;
            record.sprite.zIndex = calculateLayerZIndex(trackIdx, maxTrackIndex, renderOrder);
          }
        }
      } else if (layer.layerType === "text") {
        const textLayer = layer as EvaluatedTextLayer;
        const sprite = await renderTextLayerBridged(textLayer, frameId, baseMediaContainer, viewport, renderOrder);
        const trackIdx = textLayer.trackIndex ?? 0;
        sprite.zIndex = calculateLayerZIndex(trackIdx, maxTrackIndex, renderOrder);
      }
    }

    // Ensure children are sorted by their zIndex before rendering
    if (typeof baseMediaContainer.sortChildren === "function") {
      baseMediaContainer.sortChildren();
    }

    // 2. Reconcile frames
    endTextFrame(frameId, baseMediaContainer);
    endStickerFrame(frameId, baseMediaContainer);

    if (isTransitionActive && activeTransition && definition) {
      const outIdx = sortedLayers.findIndex((l) => l.layerId === activeTransition.outgoingLayer);
      const inIdx = sortedLayers.findIndex((l) => l.layerId === activeTransition.incomingLayer);
      const transitionOrder = Math.max(0, outIdx, inIdx);

      await this.composeActiveTransition(activeTransition, definition, scene, baseMediaContainer, transitionOrder, videoElements, resourceHandleMap);
    }

    // Use sprite lifecycle manager to reconcile sprite states
    this.spriteLifecycle.reconcileSprites(frameId, baseMediaContainer);

    // 3. Render stage
    this.renderer.render();
  }

  private async composeActiveTransition(transition: EvaluatedTransition, definition: any, scene: EvaluatedScene, baseMediaContainer: Container, renderOrder: number, videoElements: Map<string, HTMLVideoElement>, resourceHandleMap?: Map<string, any>): Promise<void> {
    const outgoingLayer = scene.visualLayers.find((l) => l.layerId === transition.outgoingLayer) as EvaluatedMediaLayer;
    const incomingLayer = scene.visualLayers.find((l) => l.layerId === transition.incomingLayer) as EvaluatedMediaLayer;
    if (!outgoingLayer || !incomingLayer) return;

    const app = this.renderer.getApp();
    if (!app) return;

    const fromTex = this.renderToOffscreenTexture("from", outgoingLayer, scene, videoElements, resourceHandleMap);
    const toTex = this.renderToOffscreenTexture("to", incomingLayer, scene, videoElements, resourceHandleMap);

    // Merge transition parameters using utility function
    const transitionParams = mergeTransitionParams({}, {}, transition.params || {});

    const activeId = this.renderer.getActiveTransitionId();
    if (activeId !== definition.id) {
      this.renderer.mountTransition(definition, fromTex, toTex, transitionParams);
    }
    this.renderer.updateTransitionProgress(definition.id, transition.progress, transitionParams);

    baseMediaContainer.visible = true;

    const transitionSprite = this.renderer.getTransitionSprite();
    if (transitionSprite) {
      if (transitionSprite.parent !== baseMediaContainer) {
        transitionSprite.parent?.removeChild(transitionSprite);
        baseMediaContainer.addChild(transitionSprite);
      }
      transitionSprite.visible = true;
      transitionSprite.zIndex = renderOrder;
      transitionSprite.position.set(0, 0);
      transitionSprite.width = scene.metadata.canvasWidth || 1920;
      transitionSprite.height = scene.metadata.canvasHeight || 1080;
    }
  }

  private renderToOffscreenTexture(slot: "from" | "to", layer: EvaluatedMediaLayer, scene: EvaluatedScene, videoElements: Map<string, HTMLVideoElement>, resourceHandleMap?: Map<string, any>): RenderTexture {
    const app = this.renderer.getApp()!;
    const canvasWidth = scene.metadata.canvasWidth || 1920;
    const canvasHeight = scene.metadata.canvasHeight || 1080;

    let texture = this.transitionRenderTextures.get(slot);
    let container = this.transitionOffscreenContainers.get(slot);

    if (!texture || texture.width !== canvasWidth || texture.height !== canvasHeight || !container) {
      if (texture) {
        texture.destroy(true);
      }
      texture = RenderTexture.create({ width: canvasWidth, height: canvasHeight });
      container = new Container();
      this.transitionRenderTextures.set(slot, texture);
      this.transitionOffscreenContainers.set(slot, container);
      this.transitionLastRenderedTime.delete(slot); // Force re-render on texture recreation
    }

    // Check if we need to re-render (only when video frame changes or first render)
    const currentTime = layer.sourceTime;
    const lastRenderedTime = this.transitionLastRenderedTime.get(slot);
    const needsRender = lastRenderedTime === undefined || Math.abs(currentTime - lastRenderedTime) > 0.001;

    if (!needsRender) {
      // Reuse existing texture without re-rendering
      return texture;
    }

    // Clear the container to prevent sprite accumulation
    container.removeChildren();

    // Use media resolver to get source element
    const sourceElement = resolveMediaSource(layer, videoElements, resourceHandleMap);

    if (sourceElement) {
      const record = getOrCreateMediaSprite(layer.clipId, layer.mediaType, sourceElement, container);
      if (!record) return texture;

      record.lastSeenFrame = this.currentFrameId;

      // Update video texture using VideoTextureManager from PreviewMediaPool
      if (layer.mediaType === "video" && sourceElement instanceof HTMLVideoElement) {
        if (this.mediaPool.shouldUpdateTexture(layer.clipId, sourceElement)) {
          record.texture.source.update();
          this.mediaPool.markTextureClean(layer.clipId);
        }
      }

      const layersCopy = { ...layer, opacity: 1.0 };
      const internalViewport = {
        scale: 1.0,
        offsetX: 0,
        offsetY: 0,
        pixelRatio: 1.0,
        projectWidth: canvasWidth,
        projectHeight: canvasHeight,
      };

      applyMediaTransform(record.sprite, layersCopy, internalViewport);

      // Apply filters using filter manager
      this.filterManager.applyFilters(record.sprite, layersCopy, new Map());

      record.sprite.visible = true;
      record.sprite.zIndex = 0;

      app.renderer.render({ container, target: texture, clear: true });

      // Mark this time as rendered
      this.transitionLastRenderedTime.set(slot, currentTime);
    }

    return texture;
  }

  destroy(): void {
    this.isDestroying = true;

    // Remove context loss handlers
    if (this.canvas && this.contextLostHandler) {
      this.canvas.removeEventListener("webglcontextlost", this.contextLostHandler);
      this.contextLostHandler = null;
    }
    if (this.canvas && this.contextRestoredHandler) {
      this.canvas.removeEventListener("webglcontextrestored", this.contextRestoredHandler);
      this.contextRestoredHandler = null;
    }
    this.canvas = null;

    clearFilterCache();

    // Clean up offscreen textures
    for (const texture of this.transitionRenderTextures.values()) {
      texture.destroy(true);
    }
    this.transitionRenderTextures.clear();

    for (const container of this.transitionOffscreenContainers.values()) {
      container.destroy({ children: true });
    }
    this.transitionOffscreenContainers.clear();

    if (this.renderer) {
      const baseMediaContainer = this.renderer.getOverlayContainer() || this.renderer.getApp()?.stage;
      if (baseMediaContainer) {
        clearAllMediaSprites(baseMediaContainer);
      }
      this.renderer.destroy();
    }
  }
}
