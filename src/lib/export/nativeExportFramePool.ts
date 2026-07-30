import { invoke } from "@tauri-apps/api/core";

export type ExportVideoSource = HTMLVideoElement | HTMLCanvasElement;

interface NativeFrameSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  imageData: ImageData;
}

interface NativeFrameRequest {
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

  async acquire(request: NativeFrameRequest): Promise<HTMLCanvasElement> {
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
    const response = await invoke<ArrayBuffer | Uint8Array | number[]>(
      "decode_export_frame",
      {
        videoPath: request.videoPath,
        timeSecs: request.timeSecs,
        width,
        height,
      },
    );
    const rgba = toUint8Array(response);
    const expectedBytes = width * height * 4;

    if (rgba.byteLength !== expectedBytes) {
      throw new Error(
        `Native export frame size mismatch: expected ${expectedBytes} bytes, got ${rgba.byteLength}`,
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
