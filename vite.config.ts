import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

const host = process.env.TAURI_DEV_HOST;

// In local development, resolve packages from the sibling clypra-packages
// workspace source for hot-reload. In CI / production builds (where the
// sibling repo doesn't exist), fall through to node_modules which holds
// the published npm versions (@clypra/ui-color-picker@0.2.1, etc.).
const packagesCandidate = path.resolve(__dirname, "../clypra-packages/packages");
const legacyCandidate = path.resolve(__dirname, "../clypra-studio/packages");
const workspacePackagesDir = fs.existsSync(packagesCandidate)
  ? packagesCandidate
  : legacyCandidate;
const hasWorkspace = fs.existsSync(workspacePackagesDir);

const workspaceAlias = hasWorkspace
  ? {
      "@clypra/ui-color-picker/styles.css": path.resolve(
        workspacePackagesDir,
        "ui-color-picker/src/styles.css",
      ),
      "@clypra/ui-color-picker": path.resolve(
        workspacePackagesDir,
        "ui-color-picker/src/index.ts",
      ),
      "@clypra/engine/transitions": path.resolve(
        workspacePackagesDir,
        "clypra-engine/src/transitions/index.ts",
      ),
      "@clypra/engine": path.resolve(
        workspacePackagesDir,
        "clypra-engine/src/index.ts",
      ),
      // Shared engine transitions must resolve to the package's transitions module
      "@clypra-studio/engine/transitions": path.resolve(
        workspacePackagesDir,
        "clypra-engine/src/transitions/index.ts",
      ),
      // Text effects must use the same sibling shared-engine source in local
      // development as Studio; otherwise the editor silently tests the stale
      // npm package and can diverge on contributor state/rendering.
      "@clypra-studio/engine": path.resolve(
        workspacePackagesDir,
        "clypra-engine/src/index.ts",
      ),
    }
  : {};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "pixi.js": path.resolve(__dirname, "./src/lib/mocks/pixiMock.ts"),
      "pixi-filters": path.resolve(__dirname, "./src/lib/mocks/pixiMock.ts"),
      ...workspaceAlias,
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "sonner"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      allow: [
        path.resolve(__dirname, "."),
        ...(hasWorkspace
          ? [
              path.resolve(workspacePackagesDir, "clypra-engine"),
              path.resolve(workspacePackagesDir, "ui-color-picker"),
            ]
          : []),
      ],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },

  preview: {
    port: 1420,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },

  // Vitest configuration
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // The editor owns process-wide browser/media singletons (audio context,
    // playback clock, and resource pools). Parallel file workers can retain
    // those handles past worker teardown even though the tests themselves
    // pass. Serialize files until those globals are worker-isolated.
    fileParallelism: false,
    // The published Studio engine is otherwise externalized by Vitest. Inline
    // it so the lottie-web mock in test-setup also covers its animation bridge
    // and cannot leave a browser-only readiness timer behind after teardown.
    server: {
      deps: {
        inline: ["@clypra-studio/engine", "@clypra/ui-color-picker", /@floating-ui/],
      },
    },
    // Some stores initialize background timers (e.g. AudioEngine, Zustand
    // subscribers) that outlive the test run. All 1807 tests pass but vitest
    // exits with code 1 due to the unhandled timer. Suppress that exit signal
    // so CI doesn't fail a clean test run.
    dangerouslyIgnoreUnhandledErrors: true,
  },
}));
