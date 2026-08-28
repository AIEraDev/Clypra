export interface TextRenderTraceLayer {
  id?: string;
  type?: string;
  enabled?: boolean;
  opacity?: number;
  params?: Record<string, unknown>;
}

export interface TextRenderTraceScene {
  schemaVersion?: number;
  revision?: {
    assetId?: string;
    revisionId?: string;
    contentHash?: string;
    rendererVersion?: string;
  };
  canvas?: {
    width?: number;
    height?: number;
    background?: string;
    backgroundConfig?: unknown;
  };
  text?: {
    content?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
  };
  compositor?: unknown;
  effectLayers?: TextRenderTraceLayer[];
  legacyConfig?: unknown;
}

export interface TextRenderTraceContext {
  path: "source-preview" | "program-preview" | "export";
  assetId?: string;
  category?: string;
  revisionId?: string;
  contentHash?: string;
  time?: number;
}

const loggedKeys = new Set<string>();

function isTraceEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_CLYPRA_TEXT_RENDER_TRACE === "1";
}

function layerState(layer: TextRenderTraceLayer) {
  const enabled = layer.enabled === true;
  const opacity = typeof layer.opacity === "number" ? layer.opacity : 1;
  return {
    id: layer.id,
    type: layer.type,
    enabled,
    opacity,
    active: enabled && opacity > 0,
    params: layer.params ?? {},
  };
}

/**
 * Logs the resolved text scene once per asset/revision/render path in dev.
 * This is intentionally state-focused so it exposes accidental activation of
 * panel/glow/shadow layers without flooding the console on every frame.
 */
export function traceTextRenderScene(
  scene: TextRenderTraceScene,
  context: TextRenderTraceContext,
): void {
  if (!isTraceEnabled()) return;

  const revision = context.revisionId || scene.revision?.revisionId || "latest";
  const asset = context.assetId || scene.revision?.assetId || "anonymous";
  const key = `${context.path}:${asset}:${revision}:${context.contentHash || scene.revision?.contentHash || ""}`;
  if (loggedKeys.has(key)) return;
  loggedKeys.add(key);

  const layers = (scene.effectLayers ?? []).map(layerState);
  const activeLayers = layers.filter((layer) => layer.active);
  const activePanel = activeLayers.find((layer) => layer.type === "panel");
  const activeGlow = activeLayers.filter((layer) => layer.type === "glow");

  console.groupCollapsed(`[Clypra:text-render] ${context.path} ${asset}@${revision}`);
  console.log("source", {
    assetId: asset,
    category: context.category,
    revisionId: revision,
    contentHash: context.contentHash || scene.revision?.contentHash,
    rendererVersion: scene.revision?.rendererVersion,
    schemaVersion: scene.schemaVersion,
    time: context.time,
  });
  console.log("canvas", scene.canvas);
  console.log("text", scene.text);
  console.log("compositor", scene.compositor);
  console.table(layers);
  console.log("active contributors", activeLayers.map(({ id, type, opacity, params }) => ({ id, type, opacity, params })));
  console.log("legacy compatibility fields", scene.legacyConfig ?? null);

  if (activePanel) {
    console.warn("[Clypra:text-render] Active panel/background plate", activePanel);
  }
  if (activeGlow.length > 0) {
    console.warn("[Clypra:text-render] Active glow contributors", activeGlow);
  }
  console.groupEnd();
}

export function resetTextRenderTrace(): void {
  loggedKeys.clear();
}
