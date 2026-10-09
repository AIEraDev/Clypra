/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Set to "1" to enable the wgpu child-surface presenter on macOS.
   * When unset (default), EMBEDDED_PREVIEW_ONLY=true and all frames go
   * through the WebView IPC bridge. See src/lib/platform/nativeCore.ts.
   *
   * Usage:
   *   VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri dev
   *   VITE_CLYPRA_NATIVE_SURFACE=1 pnpm tauri build
   */
  readonly VITE_CLYPRA_NATIVE_SURFACE?: "1";

  /** Clypra API key for backend requests. */
  readonly VITE_CLYPRA_API_KEY?: string;

  /** Optional body segmentation runtime override (mediapipe | onnx | heuristic). */
  readonly VITE_CLYPRA_BODY_SEGMENTATION_RUNTIME?: string;
  readonly VITE_CLYPRA_BODY_SEGMENTATION_RUNTIME_SCRIPT_URL?: string;
  readonly VITE_CLYPRA_BODY_SEGMENTATION_MODEL_URL?: string;
  readonly VITE_CLYPRA_BODY_SEGMENTATION_WASM_BASE_URL?: string;

  /** Enable the native preview push bridge (experimental). Set to "1". */
  readonly VITE_CLYPRA_PREVIEW_PUSH_BRIDGE?: "1";

  /** Detached native preview window (dev harness only, not for Tauri runtime). */
  readonly VITE_CLYPRA_NATIVE_PREVIEW_ONLY?: "1";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
