/**
 * MediaPipe inference Web Worker.
 *
 * Strategy: isolated Web Worker so inference never blocks the React/PixiJS thread.
 *
 * Messages IN (from main thread):
 *   { type: 'INIT',         payload: { modelUrl: string } }
 *   { type: 'DETECT_FRAME', payload: { imageBitmap: ImageBitmap, timestampMs: number } }
 *   { type: 'DESTROY' }
 *
 * Messages OUT (to main thread):
 *   { type: 'INITIALIZED' }
 *   { type: 'DETECTION_RESULT', timestampMs: number, detections: Detection[] }
 *   { type: 'ERROR', message: string }
 */

import { FaceDetector, FilesetResolver, type Detection } from '@mediapipe/tasks-vision';

// Re-export the Detection type so the hook can import it from this worker module
export type { Detection };

let detector: FaceDetector | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data as {
    type: 'INIT' | 'DETECT_FRAME' | 'DESTROY';
    payload?: Record<string, unknown>;
  };

  try {
    if (type === 'INIT') {
      const modelUrl = payload!.modelUrl as string;

      const vision = await FilesetResolver.forVisionTasks(
        // Pin to the installed version's WASM bundle
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
      );

      detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          // Prefer GPU delegate; falls back to CPU automatically
          delegate: 'GPU',
        },
        // IMAGE mode: caller controls when frames are submitted
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3,
      });

      self.postMessage({ type: 'INITIALIZED' });
      return;
    }

    if (type === 'DETECT_FRAME') {
      if (!detector) {
        self.postMessage({ type: 'ERROR', message: 'Detector not initialised. Send INIT first.' });
        return;
      }

      const { imageBitmap, timestampMs } = payload as {
        imageBitmap: ImageBitmap;
        timestampMs: number;
      };

      // Run inference on the transferred off-screen bitmap
      const result = detector.detect(imageBitmap);

      // Release native memory immediately after inference
      imageBitmap.close();

      self.postMessage({
        type: 'DETECTION_RESULT',
        timestampMs,
        detections: result.detections,
      });
      return;
    }

    if (type === 'DESTROY') {
      // Explicitly release C++ heap and GPU buffers
      detector?.close();
      detector = null;
      self.close();
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
