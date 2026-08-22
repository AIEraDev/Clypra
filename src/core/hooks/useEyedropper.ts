// src/core/hooks/useEyedropper.ts
import { useCallback, useState } from 'react';

export interface EyedropperSurface {
  canvas?: HTMLCanvasElement;
  view?: HTMLCanvasElement;
}

export type EyedropperTarget = EyedropperSurface | HTMLCanvasElement;

export function useEyedropper(surfaceRef: React.RefObject<EyedropperTarget | null>) {
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

    // 2. Canvas fallback for runtimes without the native OS eyedropper.
    return new Promise((resolve) => {
      const target = surfaceRef.current;
      const canvas = target instanceof HTMLCanvasElement ? target : target?.view || target?.canvas;
      if (!target || !canvas) return resolve(null);

      setIsPicking(true);
      canvas.style.cursor = 'crosshair';

      const handlePointerDown = async (e: PointerEvent) => {
        cleanup();
        
        // Get canvas bounds to map screen coordinates to canvas pixels.
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);

        try {
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return resolve(null);
          const pixel = context.getImageData(
            Math.max(0, Math.min(canvas.width - 1, Math.floor(x))),
            Math.max(0, Math.min(canvas.height - 1, Math.floor(y))),
            1,
            1,
          ).data;
          if (pixel.length >= 3) {
            return resolve([pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]);
          }
        } catch (err) {
          console.warn('Canvas pixel extraction fallback failed:', err);
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
  }, [surfaceRef]);

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
