import { renderTextTemplateToCanvas, resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { TextTemplate, TemplateCustomization, RenderedFrameSequence } from "./types";
import { resolveTemplateControlValues } from "@/lib/text/templateControls";

/**
 * Renders a complete Canvas template frame-by-frame to a sequence of PNG Blobs.
 * Designed to execute synchronously per frame in the browser WebView context.
 */
export async function renderToFrameSequence(
  template: TextTemplate,
  customization: TemplateCustomization,
  onProgress?: (progress: number) => void
): Promise<RenderedFrameSequence> {
  const artifact = resolveTextTemplateArtifact(template);
  if (!artifact) throw new Error("Template does not contain a renderable text-template artifact");

  const canvas = document.createElement("canvas");
  canvas.width = artifact.document.canvas.width;
  canvas.height = artifact.document.canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }

  const controlValues = resolveTemplateControlValues(artifact, customization);

  const frames: Blob[] = [];
  const fps = artifact.timing.fps;
  const duration = artifact.timing.duration;
  const totalFrames = Math.round(duration * fps);

  for (let f = 0; f < totalFrames; f++) {
    const time = f / fps;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderTextTemplateToCanvas(ctx, {
      artifact,
      context: { environment: "export", time, width: canvas.width, height: canvas.height, controlValues },
    });

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
    width: artifact.document.canvas.width,
    height: artifact.document.canvas.height,
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
