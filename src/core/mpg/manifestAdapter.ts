/**
 * Clypra Editor — Timeline → ProjectManifestV2 adapter for V2 MPG pipeline.
 */

import {
  ProjectHelper,
  type ProjectManifestV2,
  type TrackDefinition,
  type AssetHandle,
  type EffectInstance,
} from "@clypra/engine";

export interface TimelineClipLike {
  id: string;
  assetId: string;
  timelineStartMs: number;
  timelineEndMs: number;
  sourceStartMs?: number;
  speed?: number;
  enabled?: boolean;
}

export interface TimelineEffectLike {
  id: string;
  type: string;
  params?: Record<string, unknown>;
}

const RENDERER_TO_V2_NODE: Record<string, string> = {
  brightness: "Brightness",
  contrast: "Contrast",
  gaussian_blur: "GaussianBlur",
  blur: "GaussianBlur",
  saturation: "Saturation",
  temperature: "Temperature",
  tint: "Tint",
  vignette: "Vignette",
  sepia: "Sepia",
  grayscale: "Grayscale",
  hue_rotate: "HueRotate",
  huerotate: "HueRotate",
  GaussianBlur: "GaussianBlur",
  Brightness: "Brightness",
  Contrast: "Contrast",
  Saturation: "Saturation",
  Temperature: "Temperature",
  Tint: "Tint",
  Vignette: "Vignette",
  Sepia: "Sepia",
  Grayscale: "Grayscale",
  HueRotate: "HueRotate",
  mpg_stack: "mpg_stack",
};

export interface MpgStackNode {
  type: string;
  params?: Record<string, unknown>;
}

/** Expand mpg_stack preset into flat V2 effect instances */
export function expandMpgStackEffects(effects: TimelineEffectLike[]): TimelineEffectLike[] {
  const expanded: TimelineEffectLike[] = [];
  for (const fx of effects) {
    const typeLower = fx.type.toLowerCase();
    if (typeLower === "mpg_stack") {
      const stack = (fx.params?.effectStack as MpgStackNode[] | undefined) ?? [];
      stack.forEach((node, i) => {
        expanded.push({
          id: `${fx.id}-stack-${i}`,
          type: node.type,
          params: node.params ?? {},
        });
      });
    } else {
      expanded.push(fx);
    }
  }
  return expanded;
}

export function mapRendererToV2NodeType(renderer: string): string | null {
  if (renderer.toLowerCase() === "mpg_stack") return "mpg_stack";
  return RENDERER_TO_V2_NODE[renderer] ?? RENDERER_TO_V2_NODE[renderer.toLowerCase()] ?? null;
}

export function isV2SupportedEffectStack(effects: TimelineEffectLike[]): boolean {
  const expanded = expandMpgStackEffects(effects);
  if (expanded.length === 0) return false;
  return expanded.every((e) => {
    const nodeType = mapRendererToV2NodeType(e.type);
    return nodeType !== null && nodeType !== "mpg_stack";
  });
}

export function buildManifestFromClip(
  projectId: string,
  projectName: string,
  clip: TimelineClipLike,
  effects: TimelineEffectLike[],
  options: {
    width: number;
    height: number;
    fps?: number;
    assetUri: string;
    assetKind?: AssetHandle["kind"];
  },
): ProjectManifestV2 {
  const asset: AssetHandle = {
    id: clip.assetId,
    kind: options.assetKind ?? "image",
    sourceUri: options.assetUri,
    hash: clip.assetId,
    durationMs: clip.timelineEndMs - clip.timelineStartMs,
  };

  const effectStack: EffectInstance[] = expandMpgStackEffects(effects)
    .map((fx) => {
      const nodeType = mapRendererToV2NodeType(fx.type);
      if (!nodeType || nodeType === "mpg_stack") return null;
      return {
        id: fx.id,
        type: nodeType,
        params: fx.params ?? {},
      };
    })
    .filter((e): e is EffectInstance => e !== null);

  const track: TrackDefinition = {
    id: "track-primary",
    name: "Primary",
    type: "video",
    enabled: true,
    clips: [
      {
        id: clip.id,
        assetId: clip.assetId,
        timelineStartMs: clip.timelineStartMs,
        timelineEndMs: clip.timelineEndMs,
        sourceStartMs: clip.sourceStartMs ?? 0,
        speed: clip.speed ?? 1,
        enabled: clip.enabled ?? true,
      },
    ],
    effectStack,
  };

  let manifest = ProjectHelper.createEmpty(projectId, projectName);
  manifest = { ...manifest, width: options.width, height: options.height, fps: options.fps ?? 30 };
  manifest = ProjectHelper.withAsset(manifest, asset);
  return ProjectHelper.withTrack(manifest, track);
}
