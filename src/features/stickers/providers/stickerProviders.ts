import { StickersApi, STICKER_CATEGORIES, type StickerItem } from "@/features/stickers/api/stickersApi";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";
import { stickerCacheManager } from "@/features/stickers/cache/stickerCache";
import { stickerLibraryManager } from "@/features/stickers/library/stickerLibrary";
import { platform } from "@/core/platform";
import type {
  StickerArtifact,
  StickerFormat,
  StickerPage,
  StickerProvider,
  StickerProviderId,
  StickerRef,
  StickerResolution,
  StickerSection,
} from "@/features/stickers/types";
import { shapesProvider } from "@/features/stickers/providers/shapeProvider";

const BUNDLED_SECTIONS: StickerSection[] = STICKER_CATEGORIES.map((category) => ({
  id: category,
  label: category,
  providerId: "bundled",
}));

function page(items: StickerItem[], cursor?: string): StickerPage {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const safeStart = Number.isFinite(start) && start >= 0 ? start : 0;
  const pageItems = items.slice(safeStart, safeStart + 50);
  const next = safeStart + pageItems.length;
  return {
    items: pageItems,
    hasMore: next < items.length,
    nextCursor: next < items.length ? String(next) : undefined,
  };
}

function toLottieArtifact(
  item: StickerItem & { lottieData?: Record<string, unknown> },
): StickerArtifact {
  return {
    kind: "lottie",
    format: "lottie",
    lottieData: item.lottieData ?? {},
    localAnimationPath: `bundled://${item.id}.json`,
    thumbnailPath: item.thumbnailUrl,
  };
}

const bundledProvider: StickerProvider = {
  id: "bundled",
  capabilities: {
    canStore: true,
    requiresNetwork: false,
    attributionRequired: true,
    formats: ["lottie"],
  },
  async sections() {
    return BUNDLED_SECTIONS;
  },
  async list(section, cursor) {
    const items = STARTER_STICKERS.filter(
      (item) => item.category.toLowerCase() === section.toLowerCase(),
    );
    return page(items, cursor);
  },
  async search(query, cursor) {
    const normalized = query.trim().toLowerCase();
    const items = STARTER_STICKERS.filter((item) => {
      if (!normalized) return true;
      return [item.name, item.category, ...(item.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
    return page(items, cursor);
  },
  async resolve(ref) {
    const item = STARTER_STICKERS.find((candidate) => candidate.id === ref.itemId);
    if (!item || ref.format !== "lottie") {
      return { kind: "unavailable", reason: "unsupported-format" };
    }
    return { kind: "local", artifact: toLottieArtifact(item) };
  },
};

function formatForCatalogItem(item: StickerItem): StickerFormat {
  if (item.kind === "lottie" || Boolean(item.lottieUrl)) return "lottie";
  if (item.kind === "webp" && item.animated) return "animated-webp";
  if (item.kind === "gif") return "gif";
  if (item.kind === "apng") return "apng";
  return "static";
}

function mimeTypeForStaticItem(item: StickerItem): "image/png" | "image/svg+xml" | "image/webp" {
  if (item.kind === "svg") return "image/svg+xml";
  if (item.kind === "webp") return "image/webp";
  return "image/png";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const catalogProvider: StickerProvider = {
  id: "catalog",
  capabilities: {
    canStore: true,
    requiresNetwork: true,
    attributionRequired: true,
    formats: ["lottie", "static"],
  },
  async sections() {
    return STICKER_CATEGORIES.map((category) => ({
      id: category,
      label: category,
      providerId: "catalog",
    }));
  },
  async list(section, cursor) {
    const items = await StickersApi.getStickersIndex({ category: section });
    return page(items, cursor);
  },
  async search(query, cursor) {
    const items = await StickersApi.getStickersIndex();
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? items.filter((item) =>
          [item.name, item.category, ...(item.tags ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(normalized),
        )
      : items;
    return page(filtered, cursor);
  },
  async resolve(ref) {
    let item: StickerItem;
    try {
      item = await StickersApi.getSticker(ref.itemId);
    } catch {
      return { kind: "unavailable", reason: "offline" };
    }

    const format = formatForCatalogItem(item);
    if (format === "animated-webp" || format === "apng" || (format === "gif" && ref.format !== "gif")) {
      return { kind: "unavailable", reason: "unsupported-format" };
    }
    if (format !== ref.format && !(format === "static" && ref.format === "static")) {
      return { kind: "unavailable", reason: "unsupported-format" };
    }

    try {
      const cached = await stickerCacheManager.ensureDownloaded(item);
      if (format === "lottie") {
        const parsed = cached.lottieData ?? (await stickerCacheManager.readLottieJson(cached.localAnimationPath));
        if (!isRecord(parsed)) return { kind: "unavailable", reason: "missing" };
        return {
          kind: "local",
          artifact: {
            kind: "lottie",
            format: "lottie",
            lottieData: parsed,
            localAnimationPath: cached.localAnimationPath,
            thumbnailPath: cached.localImagePath,
          },
        };
      }
      return {
        kind: "local",
        artifact: {
          kind: "static",
          format: "static",
          localPath: cached.localAnimationPath || cached.localImagePath,
          mimeType: mimeTypeForStaticItem(item),
        },
      };
    } catch {
      return { kind: "unavailable", reason: "missing" };
    }
  },
};

const yoursProvider: StickerProvider = {
  id: "yours",
  capabilities: {
    canStore: true,
    requiresNetwork: false,
    attributionRequired: false,
    formats: ["lottie", "static"],
  },
  async sections() {
    return [
      { id: "recent", label: "Recent", providerId: "yours" },
      { id: "favorites", label: "Favorites", providerId: "yours" },
      { id: "imported", label: "Imported", providerId: "yours" },
    ];
  },
  async list(section, cursor) {
    await stickerLibraryManager.initialize();
    const entries = stickerLibraryManager.list(
      section === "favorites" ? "favorites" : "recent",
    );
    const items = await Promise.all(
      entries.map(async (entry) => ({
        id: entry.itemId,
        name: entry.fileName,
        category: "yours",
        thumbnailUrl: platform.convertFileSrc(await stickerLibraryManager.getAbsolutePath(entry)),
        kind: entry.format === "lottie" ? "lottie" as const : "png" as const,
        animated: entry.format === "lottie",
        sha256: entry.contentHash,
        providerId: "yours" as const,
      })),
    );
    return page(items, cursor);
  },
  async search(query, cursor) {
    const result = await this.list("recent", cursor);
    const normalized = query.trim().toLowerCase();
    if (!normalized) return result;
    return {
      ...result,
      items: result.items.filter((item) => item.name.toLowerCase().includes(normalized)),
      hasMore: false,
      nextCursor: undefined,
    };
  },
  async resolve(ref) {
    await stickerLibraryManager.initialize();
    const entry = stickerLibraryManager.get(ref.itemId);
    if (!entry || entry.format !== ref.format) {
      return { kind: "unavailable", reason: "missing" };
    }
    if (entry.format === "lottie") {
      try {
        return {
          kind: "local",
          artifact: {
            kind: "lottie",
            format: "lottie",
            lottieData: await stickerLibraryManager.readLottieData(entry),
            localAnimationPath: await stickerLibraryManager.getAbsolutePath(entry),
            thumbnailPath: await stickerLibraryManager.getAbsolutePath(entry),
          },
        };
      } catch {
        return { kind: "unavailable", reason: "unsupported-format" };
      }
    }
    return {
      kind: "local",
      artifact: {
        kind: "imported",
        format: entry.format,
        localPath: await stickerLibraryManager.getAbsolutePath(entry),
        mimeType: "image/*",
      },
    };
  },
};

/** GIPHY is intentionally browse-disabled until storage/export policy is cleared. */
const giphyProvider: StickerProvider = {
  id: "giphy",
  capabilities: {
    canStore: false,
    requiresNetwork: true,
    attributionRequired: true,
    formats: ["gif"],
  },
  async sections() {
    return [];
  },
  async list() {
    return { items: [], hasMore: false };
  },
  async search() {
    return { items: [], hasMore: false };
  },
  async resolve() {
    return { kind: "unavailable", reason: "storage-prohibited" };
  },
};

const providers = new Map<StickerProviderId, StickerProvider>([
  [bundledProvider.id, bundledProvider],
  [catalogProvider.id, catalogProvider],
  [yoursProvider.id, yoursProvider],
  [shapesProvider.id, shapesProvider],
  [giphyProvider.id, giphyProvider],
]);

export function getStickerProvider(providerId: StickerProviderId): StickerProvider | undefined {
  return providers.get(providerId);
}

export function registerStickerProvider(provider: StickerProvider): void {
  providers.set(provider.id, provider);
}

export async function resolveSticker(ref: StickerRef): Promise<StickerResolution> {
  const provider = getStickerProvider(ref.providerId);
  if (!provider) return { kind: "unavailable", reason: "missing" };
  return provider.resolve(ref);
}

export const stickerProviders = {
  bundled: bundledProvider,
  catalog: catalogProvider,
  yours: yoursProvider,
  shapes: shapesProvider,
  giphy: giphyProvider,
};
