#!/usr/bin/env node

/**
 * State Extraction & Completeness Validator
 *
 * Scans in-scope preview/playback/native/store files using regular expressions
 * to extract all mutable state definitions:
 * - React `useState`
 * - React `useRef`
 * - Module-level and closure mutable `let` declarations
 * - Zustand store state fields
 * - Rust `static`, `OnceLock`, `Mutex`, and `Atomic` state
 *
 * Compares the extracted state identifiers against `01-state-catalog.md` (or `.csv`)
 * to verify complete coverage with zero missing items.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");

const IN_SCOPE_FILES = [
  "src/components/editor/preview/NativeProgramPreview.tsx",
  "src/components/editor/preview/nativePreviewScheduler.ts",
  "src/components/editor/preview/useNativeSurfaceController.ts",
  "src/components/editor/preview/previewHardwarePolicy.ts",
  "src/components/editor/preview/adaptiveReadbackPolicy.ts",
  "src/components/editor/preview/nativeVideoPreview.ts",
  "src/components/editor/preview/nativeTextPreview.ts",
  "src/components/editor/preview/nativeStickerPreview.ts",
  "src/components/editor/preview/playbackPushBridge.ts",
  "src/components/editor/preview/previewMediaSync.ts",
  "src/components/editor/preview/previewMode.ts",
  "src/components/editor/preview/canvasBackground.ts",
  "src/components/editor/preview/PreviewQualityManager.ts",
  "src/components/editor/transform/TransformOverlay.tsx",
  "src/components/editor/transform/calculator.ts",
  "src/components/editor/viewport/SafeOverlay.tsx",
  "src/components/editor/viewport/ViewportControls.tsx",
  "src/components/editor/timeline/Playhead.tsx",
  "src/core/playback/PlaybackClock.ts",
  "src/core/playback/PreviewPlaybackScheduler.ts",
  "src/core/playback/AudioPreviewSyncEngine.ts",
  "src/core/playback/seekController.ts",
  "src/core/playback/frameSkipping.ts",
  "src/core/playback/TransportAuthority.ts",
  "src/core/playback/previewOutputAdapters.ts",
  "src/core/runtime/nativeSurfaceLifecycle.ts",
  "src/core/runtime/ProjectSession.ts",
  "src/core/audio/nativeAudioPreviewController.ts",
  "src/core/audio/AudioEngine.ts",
  "src/lib/platform/nativeCore.ts",
  "src/lib/platform/tauri.ts",
  "src/store/uiStore.ts",
  "src/store/timelineStore.ts",
  "src/store/projectStore.ts",
  "src-tauri/src/commands/native_preview.rs",
  "src-tauri/src/commands/native_surface.rs",
  "src-tauri/src/commands/native_playback.rs",
  "src-tauri/src/commands/native_audio.rs",
  "src-tauri/src/wgpu_compositor/frame_scheduler.rs"
];

export function extractStateFromFiles(root = REPO_ROOT) {
  const extracted = new Map();

  for (const relativePath of IN_SCOPE_FILES) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;

      // React useState: const [foo, setFoo] = useState(...)
      const useStateMatch = line.match(/(?:const|let)\s+\[\s*([a-zA-Z0-9_$]+)\s*,/);
      if (useStateMatch && line.includes("useState")) {
        const name = useStateMatch[1];
        if (!extracted.has(name)) {
          extracted.set(name, { name, kind: "useState", file: relativePath, line: lineNum });
        }
      }

      // React useRef: const fooRef = useRef(...)
      const useRefMatch = line.match(/(?:const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*useRef/);
      if (useRefMatch) {
        const name = useRefMatch[1];
        if (!extracted.has(name)) {
          extracted.set(name, { name, kind: "useRef", file: relativePath, line: lineNum });
        }
      }

      // Module-level / function-level let
      const letMatch = line.match(/^\s*(?:export\s+)?let\s+([a-zA-Z0-9_$]+)\s*[:=]/);
      if (
        letMatch &&
        !line.includes("for (") &&
        !line.includes("for(") &&
        !line.includes("let i =") &&
        !line.includes("let j =") &&
        !line.includes("let index =")
      ) {
        const name = letMatch[1];
        if (!extracted.has(name)) {
          extracted.set(name, { name, kind: "let", file: relativePath, line: lineNum });
        }
      }

      // Rust statics / atomics / OnceLock / Mutex
      if (relativePath.endsWith(".rs")) {
        const rustStaticMatch = line.match(/^\s*(?:pub\s+)?static\s+([a-zA-Z0-9_]+)\s*:/);
        if (rustStaticMatch) {
          const name = rustStaticMatch[1];
          if (!extracted.has(name)) {
            extracted.set(name, { name, kind: "Rust static", file: relativePath, line: lineNum });
          }
        }
      }
    });

    // Zustand store fields inside create(...)
    if (relativePath.includes("src/store/")) {
      const createMatch = content.match(
        /create<[^>]+>\s*\(\s*(?:\([^)]*\)\s*=>\s*)?(?:\([^)]*\)\s*=>\s*)?\(\s*\{([\s\S]*?)\}\s*\)\s*\)/
      );
      if (createMatch) {
        const body = createMatch[1];
        const fieldMatches = body.matchAll(/^\s{2,4}([a-zA-Z0-9_$]+)\s*:\s*([^,\n]+)/gm);
        for (const fm of fieldMatches) {
          const fieldName = fm[1];
          if (
            !fm[2].includes("=>") &&
            !fm[2].includes("function") &&
            !fieldName.startsWith("set") &&
            !fieldName.startsWith("toggle") &&
            !fieldName.startsWith("clear") &&
            !fieldName.startsWith("add") &&
            !fieldName.startsWith("remove") &&
            !fieldName.startsWith("update") &&
            !fieldName.startsWith("open") &&
            !fieldName.startsWith("close")
          ) {
            if (!extracted.has(fieldName)) {
              extracted.set(fieldName, {
                name: fieldName,
                kind: "store field",
                file: relativePath,
                line: 1
              });
            }
          }
        }
      }
    }
  }

  return extracted;
}

export function loadCatalogStateNames(catalogPath) {
  if (!fs.existsSync(catalogPath)) {
    return new Set();
  }
  const content = fs.readFileSync(catalogPath, "utf8");
  const names = new Set();

  if (catalogPath.endsWith(".csv")) {
    const lines = content.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(",");
      const name = parts[0]?.trim();
      if (name) names.add(name);
    }
  } else {
    // Markdown table parsing
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length < 2) continue;
      const rawName = cells[0].replace(/[`*]/g, "").trim();
      if (
        rawName &&
        rawName !== "name" &&
        rawName !== "---" &&
        !rawName.startsWith(":-")
      ) {
        names.add(rawName);
      }
    }
  }

  return names;
}

function main() {
  const args = process.argv.slice(2);
  const catalogArg = args.find((a) => a.startsWith("--catalog="));
  const catalogFile = catalogArg
    ? catalogArg.split("=")[1]
    : path.join(__dirname, "../01-state-catalog.md");

  console.log("=== Clypra Preview As-Is State Extractor ===");
  console.log(`Audited Root: ${REPO_ROOT}`);
  console.log(`Checking catalog at: ${catalogFile}`);

  const extractedMap = extractStateFromFiles(REPO_ROOT);
  const catalogNames = loadCatalogStateNames(catalogFile);

  console.log(`Total extracted state variables: ${extractedMap.size}`);
  console.log(`Total variables in state catalog: ${catalogNames.size}`);

  const missing = [];
  for (const [name, info] of extractedMap.entries()) {
    if (!catalogNames.has(name)) {
      missing.push(info);
    }
  }

  if (missing.length === 0) {
    console.log("\nPASS: Zero missing state names between extracted code and catalog.");
    process.exit(0);
  } else {
    console.log(`\nFAIL: ${missing.length} extracted state variables missing from catalog:`);
    missing.slice(0, 30).forEach((m) => {
      console.log(`  - ${m.name} (${m.kind}) at ${m.file}:${m.line}`);
    });
    if (missing.length > 30) {
      console.log(`  ... and ${missing.length - 30} more`);
    }
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
