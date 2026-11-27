import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  rename,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { platform } from "@/core/platform";
import type { SelectedFile } from "@/core/platform/platform";
import type { StickerFormat, StickerLicenseSnapshot } from "@/features/stickers/types";

const LIBRARY_DIR = "clypra_library/stickers";
const INDEX_FILE = "index.json";
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["json", "png", "svg", "webp"]);

export interface StickerLibraryEntry {
  providerId: "yours";
  itemId: string;
  contentHash: string;
  filePath: string;
  fileName: string;
  format: StickerFormat;
  importedAt: number;
  lastAccessedAt: number;
  favorite: boolean;
  license?: StickerLicenseSnapshot;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

function formatForExtension(extension: string): StickerFormat | undefined {
  if (extension === "json") return "lottie";
  if (extension === "png" || extension === "svg" || extension === "webp") return "static";
  return undefined;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class StickerLibraryManager {
  private entries = new Map<string, StickerLibraryEntry>();
  private libraryDir: string | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!platform.isTauri()) {
      this.initialized = true;
      return;
    }

    const dataDir = await appDataDir();
    this.libraryDir = await join(dataDir, LIBRARY_DIR);
    if (!(await exists(this.libraryDir))) {
      await mkdir(this.libraryDir, { recursive: true });
    }

    const indexPath = await join(this.libraryDir, INDEX_FILE);
    if (await exists(indexPath)) {
      try {
        const data = await readFile(indexPath);
        const parsed = JSON.parse(new TextDecoder().decode(data)) as StickerLibraryEntry[];
        for (const entry of parsed) this.entries.set(entry.itemId, entry);
      } catch {
        this.entries.clear();
      }
    }
    this.initialized = true;
  }

  private async saveIndex(): Promise<void> {
    if (!this.libraryDir) return;
    const indexPath = await join(this.libraryDir, INDEX_FILE);
    const temporaryPath = `${indexPath}.tmp-${Date.now()}`;
    await writeFile(
      temporaryPath,
      new TextEncoder().encode(JSON.stringify(Array.from(this.entries.values()), null, 2)),
    );
    await rename(temporaryPath, indexPath);
  }

  async importFile(file: SelectedFile): Promise<StickerLibraryEntry> {
    await this.initialize();
    if (!this.libraryDir) throw new Error("Sticker imports require the desktop file system");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Sticker file exceeds the 50 MiB limit");

    const fileName = sanitizeFileName(file.name);
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    const format = formatForExtension(extension);
    if (!format || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("Unsupported sticker import format");
    }

    const data = await readFile(file.path);
    if (data.length > MAX_IMPORT_BYTES) throw new Error("Sticker file exceeds the 50 MiB limit");
    const contentHash = await sha256Hex(data);
    const itemId = `import-${contentHash}`;
    const relativePath = `${LIBRARY_DIR}/${contentHash}.${extension}`;
    const targetPath = await join(this.libraryDir, `${contentHash}.${extension}`);
    if (!(await exists(targetPath))) {
      await writeFile(targetPath, data);
    }

    const now = Date.now();
    const entry: StickerLibraryEntry = {
      providerId: "yours",
      itemId,
      contentHash,
      filePath: relativePath,
      fileName,
      format,
      importedAt: this.entries.get(itemId)?.importedAt ?? now,
      lastAccessedAt: now,
      favorite: this.entries.get(itemId)?.favorite ?? false,
    };
    this.entries.set(itemId, entry);
    await this.saveIndex();
    return entry;
  }

  list(filter: "recent" | "favorites" | "imported" = "recent"): StickerLibraryEntry[] {
    const entries = Array.from(this.entries.values());
    const filtered = filter === "favorites" ? entries.filter((entry) => entry.favorite) : entries;
    return filtered.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  get(itemId: string): StickerLibraryEntry | undefined {
    const entry = this.entries.get(itemId);
    if (entry) entry.lastAccessedAt = Date.now();
    return entry;
  }

  async getAbsolutePath(entry: StickerLibraryEntry): Promise<string> {
    await this.initialize();
    if (!this.libraryDir) throw new Error("Sticker library is unavailable");
    return join(this.libraryDir, `${entry.contentHash}.${entry.fileName.split(".").pop() ?? "bin"}`);
  }

  async readLottieData(entry: StickerLibraryEntry): Promise<Record<string, unknown>> {
    const data = await readFile(await this.getAbsolutePath(entry));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Imported Lottie JSON must contain an object");
    }
    return parsed as Record<string, unknown>;
  }

  async setFavorite(itemId: string, favorite: boolean): Promise<boolean> {
    const entry = this.entries.get(itemId);
    if (!entry) return false;
    entry.favorite = favorite;
    await this.saveIndex();
    return true;
  }

  async remove(itemId: string): Promise<boolean> {
    await this.initialize();
    const entry = this.entries.get(itemId);
    if (!entry) return false;
    if (this.libraryDir) {
      const path = await join(this.libraryDir, `${entry.contentHash}.${entry.fileName.split(".").pop() ?? "bin"}`);
      if (await exists(path)) await remove(path);
    }
    this.entries.delete(itemId);
    await this.saveIndex();
    return true;
  }
}

export const stickerLibraryManager = new StickerLibraryManager();
