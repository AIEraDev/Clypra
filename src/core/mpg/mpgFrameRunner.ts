/**
 * Clypra Editor — V2 MPG frame execution (compile → validate → plan → render).
 */

import {
  ProjectCompiler,
  FrameGraphBuilder,
  GraphValidator,
  NodeRegistry,
  type ProjectManifestV2,
  type MediaProcessingGraph,
} from "@clypra-studio/engine";

const registry = NodeRegistry.createDefault();
const validator = new GraphValidator(registry);

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
 * The old browser frame execution API was intentionally removed. MPG is
 * now a native render contract: callers compile and validate the graph here,
 * then submit it through the native frame request/daemon boundary.
 */
