import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime, renderNativeFrame } from "@/lib/platform/tauri";
import {
  DEFAULT_NATIVE_COLOR_POLICY,
  createNativeFrameRequest,
  frameIndexToNativeTime,
  secondsToNativeTime,
} from "@/lib/platform/nativeCore";

export type ExportVideoSource = HTMLVideoElement | HTMLCanvasElement;

interface NativeFrameSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  imageData: ImageData;
}

interface ExportFrameRequest {
  key: string;
  videoPath: string;
  timeSecs: number;
  width: number;
  height: number;
}

export function fitNativeFrameDimensions(
  maxWidth: number,
  maxHeight: number,
  sourceWidth?: number,
  sourceHeight?: number,
): { width: number; height: number } {
  const boundedWidth = Math.max(1, Math.round(maxWidth));
  const boundedHeight = Math.max(1, Math.round(maxHeight));

  if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: boundedWidth, height: boundedHeight };
  }

  const scale = Math.min(
    boundedWidth / sourceWidth,
    boundedHeight / sourceHeight,
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function toUint8Array(value: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

/**
 * Supplies Pixi with stable canvas-backed video sources whose pixels come from
 * Clypra's native sequential FFmpeg decoder. Reusing one canvas per clip keeps
 * the Pixi texture stable while avoiding WebKit's slow paused-video seek path.
 */
export class NativeExportFramePool {
  private readonly surfaces = new Map<string, NativeFrameSurface>();
  private readonly videoPaths = new Set<string>();

  async acquire(request: ExportFrameRequest): Promise<HTMLCanvasElement> {
    const width = Math.max(1, Math.round(request.width));
    const height = Math.max(1, Math.round(request.height));
    let surface = this.surfaces.get(request.key);

    if (!surface) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to create native export frame canvas");
      }

      surface = {
        canvas,
        context,
        imageData: context.createImageData(width, height),
      };
      this.surfaces.set(request.key, surface);
    } else if (
      surface.canvas.width !== width ||
      surface.canvas.height !== height
    ) {
      surface.canvas.width = width;
      surface.canvas.height = height;
      surface.imageData = surface.context.createImageData(width, height);
    }

    this.videoPaths.add(request.videoPath);
    const expectedBytes = width * height * 4;
    let rgba: Uint8Array | null = null;
    let lastError: any = null;

    const backoffs = [10, 25, 50];
    for (let attempt = 0; attempt <= backoffs.length; attempt++) {
      try {
        const frameIndex = Math.max(0, Math.round(request.timeSecs * 30));
        const nativeRequest = createNativeFrameRequest({
          requestId: `export:${request.key}:${frameIndex}:${width}x${height}`,
          frameTime: frameIndexToNativeTime(frameIndex, 30),
          project: {
            schemaVersion: 1,
            projectRevision: `export:${request.key}`,
            canvasWidth: width,
            canvasHeight: height,
            clearColor: [0, 0, 0, 1],
            videoLayers: [{
              assetId: request.key,
              videoPath: request.videoPath,
              sourceTime: secondsToNativeTime(request.timeSecs, frameIndex),
              x: 0,
              y: 0,
              width,
              height,
              rotation: 0,
              opacity: 1,
              zIndex: 0,
              blendMode: "normal",
            }],
          },
          outputWidth: width,
          outputHeight: height,
          quality: "full",
          colorPolicy: DEFAULT_NATIVE_COLOR_POLICY,
          renderGraphVersion: 1,
        });
        // Desktop uses the versioned native frame service. The old command is
        // retained only for non-Tauri adapter tests/web callers until export
        // itself is fully native and no canvas bridge remains.
        const response = isTauriRuntime()
          ? await renderNativeFrame(nativeRequest)
          : await invoke<ArrayBuffer | Uint8Array | number[]>("decode_export_frame", {
            videoPath: request.videoPath,
            timeSecs: request.timeSecs,
            width,
            height,
          });
        const candidate = toUint8Array(response);
        if (candidate.byteLength === expectedBytes) {
          rgba = candidate;
          break;
        }
        lastError = new Error(`Byte length mismatch: expected ${expectedBytes} bytes, got ${candidate.byteLength}`);
      } catch (err) {
        lastError = err;
      }

      if (attempt < backoffs.length) {
        await new Promise((r) => setTimeout(r, backoffs[attempt]));
      }
    }

    if (!rgba) {
      throw new Error(
        `Failed to decode frame at timestamp ${request.timeSecs}s for video ${request.videoPath}: ${lastError?.message || lastError}. Export aborted to prevent output corruption.`,
      );
    }

    surface.imageData.data.set(rgba);
    surface.context.putImageData(surface.imageData, 0, 0);
    return surface.canvas;
  }

  async clear(): Promise<void> {
    for (const path of this.videoPaths) {
      await invoke("release_video_decoder", { videoPath: path }).catch(() => {});
    }
    for (const surface of this.surfaces.values()) {
      surface.canvas.width = 0;
      surface.canvas.height = 0;
    }
    this.videoPaths.clear();
    this.surfaces.clear();
  }
}
