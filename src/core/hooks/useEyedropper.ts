// src/core/hooks/useEyedropper.ts
import { useCallback, useState } from 'react';
import * as PIXI from 'pixi.js';

export function useEyedropper(pixiAppRef: React.RefObject<PIXI.Application | null>) {
  const [isPicking, setIsPicking] = useState(false);

  const pickColor = useCallback(async (): Promise<[number, number, number] | null> => {
    // 1. Fast Path: Native OS Eyedropper (Chromium / Edge WebView2)
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const EyeDropperCtor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
        const dropper = new EyeDropperCtor();
        const result = await dropper.open();
        return hexToRgbFloat(result.sRGBHex);
      } catch {
        // User canceled or failed
        return null;
      }
    }

    // 2. macOS WebKit Fallback: PixiJS WebGL Pixel Extraction
    return new Promise((resolve) => {
      const app = pixiAppRef.current;
      const canvas = (app?.view || (app as unknown as { canvas?: HTMLCanvasElement })?.canvas) as HTMLCanvasElement | undefined;
      if (!app || !canvas) return resolve(null);

      setIsPicking(true);
      canvas.style.cursor = 'crosshair';

      const handlePointerDown = async (e: PointerEvent) => {
        cleanup();
        
        // Get canvas bounds to map screen coords to WebGL render coords
        const rect = canvas.getBoundingClientRect();
        const resolution = (app.renderer as unknown as { resolution?: number })?.resolution ?? 1;
        const rendererWidth = (app.renderer as unknown as { width?: number })?.width ?? canvas.width;
        const rendererHeight = (app.renderer as unknown as { height?: number })?.height ?? canvas.height;
        
        const x = ((e.clientX - rect.left) * (rendererWidth / rect.width)) / resolution;
        const y = ((e.clientY - rect.top) * (rendererHeight / rect.height)) / resolution;

        try {
          const region = new PIXI.Rectangle(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), 1, 1);
          const extract = app.renderer?.extract as unknown as {
            pixels?: (target?: unknown, frame?: PIXI.Rectangle) => unknown;
          };

          if (extract && typeof extract.pixels === 'function') {
            const rawResult = await extract.pixels(app.stage, region);
            let pixels: ArrayLike<number> | null = null;

            if (rawResult && typeof rawResult === 'object') {
              if ('pixels' in (rawResult as Record<string, unknown>)) {
                pixels = (rawResult as { pixels: ArrayLike<number> }).pixels;
              } else if (ArrayBuffer.isView(rawResult) || Array.isArray(rawResult)) {
                pixels = rawResult as ArrayLike<number>;
              }
            }

            if (pixels && pixels.length >= 3) {
              return resolve([pixels[0] / 255, pixels[1] / 255, pixels[2] / 255]);
            }
          }
        } catch (err) {
          console.warn('WebGL pixel extraction fallback failed:', err);
        }

        resolve(null);
      };

      const cleanup = () => {
        setIsPicking(false);
        if (canvas) {
          canvas.style.cursor = 'default';
        }
        window.removeEventListener('pointerdown', handlePointerDown);
      };

      // Add to window with once: true so clicking once anywhere resolves
      window.addEventListener('pointerdown', handlePointerDown, { once: true });
    });
  }, [pixiAppRef]);

  return { pickColor, isPicking };
}

function hexToRgbFloat(hex: string): [number, number, number] {
  const bigint = parseInt(hex.replace('#', ''), 16);
  return [
    ((bigint >> 16) & 255) / 255,
    ((bigint >> 8) & 255) / 255,
    (bigint & 255) / 255,
  ];
}
