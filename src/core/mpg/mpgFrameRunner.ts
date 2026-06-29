/**
 * Clypra Editor — V2 MPG frame execution (compile → validate → plan → render).
 */

import {
  ProjectCompiler,
  FrameGraphBuilder,
  GraphValidator,
  NodeRegistry,
  MPGFrameRenderer,
  PixiRenderBackend,
  type ProjectManifestV2,
  type MediaProcessingGraph,
} from "@clypra/engine";
import type { FrameSource } from "@clypra/engine";

const registry = NodeRegistry.createDefault();
const validator = new GraphValidator(registry);

let sharedBackend: PixiRenderBackend | null = null;
let sharedCanvas: HTMLCanvasElement | null = null;

export interface MPGRenderOptions {
  timelineTimeMs: number;
  frameNumber?: number;
  width: number;
  height: number;
}

export function compileManifest(manifest: ProjectManifestV2): MediaProcessingGraph {
  return ProjectCompiler.compile(manifest, registry);
}

export function validateGraph(graph: MediaProcessingGraph) {
  return validator.validate(graph);
}

/**
 * Render a frame through the V2 pipeline into an offscreen canvas.
 */
export async function renderMPGFrame(
  manifest: ProjectManifestV2,
  source: FrameSource,
  options: MPGRenderOptions,
): Promise<HTMLCanvasElement> {
  const graph = compileManifest(manifest);
  const validation = validateGraph(graph);
  if (!validation.valid) {
    throw new Error(`MPG graph invalid: ${validation.errors.map((e) => e.message).join("; ")}`);
  }

  const frameGraph = FrameGraphBuilder.build(
    graph,
    options.timelineTimeMs,
    options.frameNumber ?? 0,
    options.width,
    options.height,
    registry,
  );

  return MPGFrameRenderer.renderToCanvas(frameGraph, source, options.width, options.height);
}

/**
 * Initialize a persistent preview backend bound to a display canvas.
 */
export async function initMPGPreviewBackend(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<PixiRenderBackend> {
  if (sharedBackend) {
    sharedBackend.destroy();
  }
  sharedBackend = new PixiRenderBackend();
  sharedCanvas = canvas;
  await sharedBackend.init(canvas, width, height);
  return sharedBackend;
}

export function resizeMPGPreviewBackend(width: number, height: number): void {
  sharedBackend?.resize(width, height);
}

export async function renderMPGPreviewFrame(
  manifest: ProjectManifestV2,
  source: FrameSource,
  options: MPGRenderOptions,
): Promise<void> {
  if (!sharedBackend) {
    throw new Error("MPG preview backend not initialized");
  }

  const graph = compileManifest(manifest);
  const validation = validateGraph(graph);
  if (!validation.valid) {
    throw new Error(`MPG graph invalid: ${validation.errors.map((e) => e.message).join("; ")}`);
  }

  const frameGraph = FrameGraphBuilder.build(
    graph,
    options.timelineTimeMs,
    options.frameNumber ?? 0,
    options.width,
    options.height,
    registry,
  );

  await MPGFrameRenderer.render(sharedBackend, frameGraph, source);
}

export function destroyMPGPreviewBackend(): void {
  sharedBackend?.destroy();
  sharedBackend = null;
  sharedCanvas = null;
}
