import { TemplateRenderer } from "@clypra-studio/engine";
import { TextTemplate, TemplateCustomization, RenderedFrameSequence } from "./types";

/**
 * Renders a complete Canvas template frame-by-frame to a sequence of PNG Blobs.
 * Designed to execute synchronously per frame in the browser WebView context.
 */
export async function renderToFrameSequence(
  template: TextTemplate,
  customization: TemplateCustomization,
  onProgress?: (progress: number) => void
): Promise<RenderedFrameSequence> {
  const canvas = document.createElement("canvas");
  canvas.width = template.canvasWidth;
  canvas.height = template.canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }

  const renderer = new TemplateRenderer(template as any);

  // Apply customizations to the renderer's overrides
  const layers = template.layers || [];
  for (const layer of layers) {
    if (layer.kind === "text") {
      const changes: any = {};
      if (layer.role === "primary") {
        changes.content = customization.primaryText;
        if (customization.primaryColor) changes.color = customization.primaryColor;
      } else if (layer.role === "secondary") {
        changes.content = customization.secondaryText ?? "";
        if (customization.secondaryColor) changes.color = customization.secondaryColor;
      } else if (layer.role === "accent") {
        changes.content = customization.accentText ?? "";
      }
      renderer.updateLayer(layer.id, changes);
    } else if (layer.kind === "shape") {
      const colorOverride = layer.id === "primary-fill-layer" 
        ? customization.primaryColor 
        : layer.id === "secondary-fill-layer" 
          ? customization.secondaryColor 
          : undefined;
      if (colorOverride) {
        renderer.updateLayer(layer.id, { fill: colorOverride });
      }
    }
  }

  const frames: Blob[] = [];
  const fps = 30; // standard output frame rate
  const duration = template.defaultDuration ?? template.duration ?? 3.0;
  const totalFrames = Math.round(duration * fps);

  for (let f = 0; f < totalFrames; f++) {
    const time = f / fps;
    renderer.drawFrame(ctx, time);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error(`Failed to rasterize frame ${f} to PNG Blob`));
      }, "image/png");
    });

    frames.push(blob);

    if (onProgress) {
      onProgress(Math.round(((f + 1) / totalFrames) * 100));
    }
  }

  return {
    frames,
    fps,
    width: template.canvasWidth,
    height: template.canvasHeight,
    durationFrames: totalFrames,
  };
}

/**
 * Transfers the rendered PNG blobs to the Tauri Rust native backend.
 */
export async function renderFrameSequenceToTauri(
  sequence: RenderedFrameSequence,
  outputDir: string
): Promise<string[]> {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const paths: string[] = [];

  for (let i = 0; i < sequence.frames.length; i++) {
    const blob = sequence.frames[i];
    const buffer = await blob.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Standard 4-digit zero-padded filename: e.g. /output/0000.png, /output/0001.png
    const fileName = `${String(i).padStart(4, "0")}.png`;
    // Clean directory path handling
    const cleanDir = outputDir.endsWith("/") || outputDir.endsWith("\\")
      ? outputDir
      : `${outputDir}/`;
    const framePath = `${cleanDir}${fileName}`;

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        // Cast data to standard number array for Tauri JSON serialization compatibility
        const bytes = Array.from(data);
        await invoke("write_frame", { path: framePath, data: bytes });
      } catch (err) {
        console.error(`Tauri failed to write frame ${i}:`, err);
        throw err;
      }
    }

    paths.push(framePath);
  }

  return paths;
}
