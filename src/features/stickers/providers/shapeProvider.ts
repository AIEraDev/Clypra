import type { StickerItem } from "@/features/stickers/api/stickersApi";
import type {
  ShapeSpec,
  ShapeType,
  StickerArtifact,
  StickerPage,
  StickerProvider,
  StickerResolution,
  StickerSection,
} from "@/features/stickers/types";

const SHAPE_TYPES: ShapeType[] = [
  "rectangle",
  "rounded-rectangle",
  "circle",
  "ellipse",
  "triangle",
  "star",
  "heart",
  "arrow",
  "line",
  "speech-bubble",
  "polygon",
];

const SHAPE_SET = new Set<ShapeType>(SHAPE_TYPES);

const DEFAULT_SPEC: Omit<ShapeSpec, "type"> = {
  width: 360,
  height: 360,
  fill: "#38BDF8",
  stroke: "#0F172A",
  strokeWidth: 8,
  cornerRadius: 28,
  points: 6,
  innerRadius: 0.5,
  rotation: 0,
};

function makeShapeSpec(type: ShapeType): ShapeSpec {
  return { ...DEFAULT_SPEC, type };
}

function hexToColor(value: string): number[] {
  const normalized = value.replace("#", "");
  const hex = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(red) ? red : 0,
    Number.isFinite(green) ? green : 0,
    Number.isFinite(blue) ? blue : 0,
    1,
  ];
}

function makeLottie(spec: ShapeSpec): Record<string, unknown> {
  const shape =
    spec.type === "circle" || spec.type === "ellipse"
      ? {
          ty: "el",
          p: { a: 0, k: [spec.width / 2, spec.height / 2] },
          s: { a: 0, k: [spec.width, spec.height] },
        }
      : spec.type === "star"
        ? {
            ty: "sr",
            sy: 1,
            d: 1,
            pt: { a: 0, k: spec.points ?? 6 },
            p: { a: 0, k: [spec.width / 2, spec.height / 2] },
            r: { a: 0, k: spec.rotation ?? 0 },
            ir: { a: 0, k: spec.width * (spec.innerRadius ?? 0.5) / 2 },
            or: { a: 0, k: spec.width / 2 },
          }
        : {
            ty: "rc",
            p: { a: 0, k: [spec.width / 2, spec.height / 2] },
            s: { a: 0, k: [spec.width, spec.height] },
            r: { a: 0, k: spec.cornerRadius ?? 0 },
          };

  return {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 1,
    w: spec.width,
    h: spec.height,
    nm: `Clypra ${spec.type}`,
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: spec.type,
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [0, 0, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          shape,
          { ty: "fl", c: { a: 0, k: hexToColor(spec.fill) }, o: { a: 0, k: 100 }, r: 1 },
          { ty: "st", c: { a: 0, k: hexToColor(spec.stroke) }, o: { a: 0, k: 100 }, w: { a: 0, k: spec.strokeWidth }, lc: 2, lj: 2 },
        ],
      },
    ],
  };
}

function makeThumbnail(spec: ShapeSpec): string {
  const shape = spec.type === "circle" || spec.type === "ellipse"
    ? `<ellipse cx="50" cy="50" rx="38" ry="34" fill="${spec.fill}" stroke="${spec.stroke}" stroke-width="4"/>`
    : `<rect x="12" y="16" width="76" height="68" rx="${Math.min(18, spec.cornerRadius ?? 0)}" fill="${spec.fill}" stroke="${spec.stroke}" stroke-width="4"/>`;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${shape}</svg>`)}`;
}

function toDataUrl(data: Record<string, unknown>): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(data))}`;
}

export function getShapeItems(): StickerItem[] {
  return SHAPE_TYPES.map((type) => {
    const spec = makeShapeSpec(type);
    return {
      id: `shape-${type}`,
      providerId: "shapes",
      name: type,
      category: "shape",
      thumbnailUrl: makeThumbnail(spec),
      kind: "lottie",
      animated: false,
      shape: spec,
    };
  });
}

const sections: StickerSection[] = [{ id: "all", label: "Shapes", providerId: "shapes" }];

export const shapesProvider: StickerProvider = {
  id: "shapes",
  capabilities: {
    canStore: false,
    requiresNetwork: false,
    attributionRequired: false,
    formats: ["lottie"],
  },
  async sections() {
    return sections;
  },
  async list(_section, cursor) {
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    const items = getShapeItems().slice(Number.isFinite(start) ? start : 0);
    return {
      items,
      hasMore: false,
      nextCursor: undefined,
    } satisfies StickerPage;
  },
  async search(query, cursor) {
    const normalized = query.trim().toLowerCase();
    const items = getShapeItems().filter((item) => !normalized || item.name.includes(normalized));
    return {
      items: cursor ? [] : items,
      hasMore: false,
      nextCursor: undefined,
    } satisfies StickerPage;
  },
  async resolve(ref): Promise<StickerResolution> {
    const type = ref.shape?.type ?? ref.itemId.replace(/^shape-/, "");
    if (!SHAPE_SET.has(type as ShapeType) || ref.format !== "lottie") {
      return { kind: "unavailable", reason: "unsupported-format" };
    }
    const spec = ref.shape ?? makeShapeSpec(type as ShapeType);
    const lottieData = makeLottie(spec);
    return {
      kind: "local",
      artifact: {
        kind: "shape",
        format: "lottie",
        shape: spec,
        lottieData,
        localAnimationPath: toDataUrl(lottieData),
        thumbnailPath: makeThumbnail(spec),
      },
    } satisfies StickerResolution;
  },
};
