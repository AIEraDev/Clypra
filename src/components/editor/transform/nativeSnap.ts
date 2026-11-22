import type { Clip } from "@/types";
import type { ActiveSnapGuides, DragGeometry } from "@/core/interactions/TransformController";

export interface NativeSnapResult {
  geometry: DragGeometry;
  guides: ActiveSnapGuides | null;
}

/** Apply alignment and canvas-edge snapping to a native preview drag. */
export function applyNativeTransformSnapping(input: {
  geometry: DragGeometry;
  clip: Clip;
  activeClips: readonly Clip[];
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  handle: string;
}): NativeSnapResult {
  if (input.handle !== "move" || input.geometry.rotation !== 0) {
    return { geometry: input.geometry, guides: null };
  }
  const threshold = Math.max(8, 14 / Math.max(0.05, input.scale));
  const xCandidates = [0, input.canvasWidth / 2, input.canvasWidth];
  const yCandidates = [0, input.canvasHeight / 2, input.canvasHeight];
  for (const clip of input.activeClips) {
    if (clip.id === input.clip.id) continue;
    xCandidates.push(clip.x, clip.x + clip.width / 2, clip.x + clip.width);
    yCandidates.push(clip.y, clip.y + clip.height / 2, clip.y + clip.height);
  }
  const x = snapAxis(input.geometry.x, input.geometry.width, xCandidates, threshold);
  const y = snapAxis(input.geometry.y, input.geometry.height, yCandidates, threshold);
  const geometry = { ...input.geometry, x: x.value, y: y.value };
  if (!x.snapped && !y.snapped) return { geometry, guides: null };
  return {
    geometry,
    guides: {
      snappedX: x.snapped,
      snappedY: y.snapped,
      snappedLeft: x.edge === "start",
      snappedRight: x.edge === "end",
      snappedTop: y.edge === "start",
      snappedBottom: y.edge === "end",
      snapGuideX: x.guide,
      snapGuideY: y.guide,
    },
  };
}

function snapAxis(position: number, size: number, targets: readonly number[], threshold: number) {
  const candidates = [
    { value: position, offset: 0, edge: "start" as const },
    { value: position + size / 2, offset: -size / 2, edge: undefined },
    { value: position + size, offset: -size, edge: "end" as const },
  ];
  let best: { distance: number; value: number; guide: number; edge?: "start" | "end" } | null = null;
  for (const source of candidates) {
    for (const target of targets) {
      const distance = Math.abs(source.value - target);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { distance, value: target + source.offset, guide: target, edge: source.edge };
      }
    }
  }
  return best ? { value: best.value, snapped: true, guide: best.guide, edge: best.edge } : { value: position, snapped: false, guide: null, edge: undefined };
}
