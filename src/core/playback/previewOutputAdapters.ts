import type { PreviewPerformancePath } from "./previewPerformanceContract";

export interface PreviewOutputAdapter {
  path: PreviewPerformancePath;
  surface: "native-surface" | "dom-canvas";
  usesCpuReadbackDuringPlayback: boolean;
}

/** Native presentation: decode/cache → GPU composition → retained surface. */
export const NativeSurfaceOutput: PreviewOutputAdapter = {
  path: "native",
  surface: "native-surface",
  usesCpuReadbackDuringPlayback: false,
};

/** WebView presentation: decode/cache → readback → bridge transfer → canvas paint. */
export const WebViewCanvasOutput: PreviewOutputAdapter = {
  path: "webview",
  surface: "dom-canvas",
  usesCpuReadbackDuringPlayback: true,
};
