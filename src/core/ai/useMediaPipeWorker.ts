/**
 * useMediaPipeWorker
 *
 * React hook managing the full lifecycle of the MediaPipe Web Worker:
 * - Creates the worker once on mount (or when modelUrl changes)
 * - Terminates and cleans up on unmount
 * - Throttles frame submissions to MAX_INFERENCE_FPS (default 12)
 * - Applies BoundingBoxKalmanSmoother for 60 FPS interpolation
 * - Provides a stable `detectFrame(bitmap)` callback safe to call from
 *   any animation frame without causing re-renders on every call
 *
 * Usage (in a PixiJS canvas component):
 *
 *   const { detectFrame, latestDetections, isReady } = useMediaPipeWorker({
 *     modelUrl: '/models/mediapipe/face-detector-short-range.task',
 *   });
 *
 *   // In the rAF loop — pass an OffscreenCanvas or ImageBitmap
 *   useEffect(() => {
 *     const bitmap = offscreenCanvas.transferToImageBitmap();
 *     detectFrame(bitmap, currentTimeMs);
 *   }, [detectFrame]);
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detection } from '@mediapipe/tasks-vision';
import { BoundingBoxKalmanSmoother, type SmoothedBoundingBox } from './KalmanSmoother';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum inference rate — stay well below render FPS to avoid GPU contention */
const MAX_INFERENCE_FPS = 12;
const MIN_FRAME_INTERVAL_MS = 1000 / MAX_INFERENCE_FPS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseMediaPipeWorkerOptions {
  /** URL or object URL for the .task / .onnx model asset */
  modelUrl: string;
  /** Override inference rate (default: 12 FPS) */
  maxFps?: number;
}

export interface UseMediaPipeWorkerResult {
  /** Whether the worker has finished initialising the model */
  isReady: boolean;
  /** Latest raw detections from the worker (null until first result) */
  latestDetections: Detection[] | null;
  /** Primary detection as a Kalman-smoothed bounding box */
  smoothedBox: SmoothedBoundingBox | null;
  /**
   * Submit a frame for inference.
   * Ownership of `bitmap` is transferred to the worker — do NOT use it after calling this.
   */
  detectFrame: (bitmap: ImageBitmap, timestampMs: number) => void;
  /** Reset the Kalman smoother (e.g., after a seek/scrub) */
  resetSmoother: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMediaPipeWorker({
  modelUrl,
  maxFps = MAX_INFERENCE_FPS,
}: UseMediaPipeWorkerOptions): UseMediaPipeWorkerResult {
  const workerRef = useRef<Worker | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const smootherRef = useRef(new BoundingBoxKalmanSmoother());
  const minInterval = 1000 / maxFps;

  const [isReady, setIsReady] = useState(false);
  const [latestDetections, setLatestDetections] = useState<Detection[] | null>(null);
  const [smoothedBox, setSmoothedBox] = useState<SmoothedBoundingBox | null>(null);

  // Create / recreate worker when modelUrl changes
  useEffect(() => {
    setIsReady(false);
    setLatestDetections(null);
    smootherRef.current.reset();

    const worker = new Worker(
      new URL('../workers/mediapipe.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: 'INITIALIZED' | 'DETECTION_RESULT' | 'ERROR';
        timestampMs?: number;
        detections?: Detection[];
        message?: string;
      };

      if (msg.type === 'INITIALIZED') {
        setIsReady(true);
        return;
      }

      if (msg.type === 'DETECTION_RESULT') {
        const detections = msg.detections ?? [];
        setLatestDetections(detections);

        // Feed the primary detection into the Kalman smoother
        const primary = detections[0];
        if (primary?.boundingBox) {
          const bb = primary.boundingBox;
          const raw: SmoothedBoundingBox = {
            x: bb.originX,
            y: bb.originY,
            width: bb.width,
            height: bb.height,
          };
          setSmoothedBox(smootherRef.current.update(raw));
        } else {
          // No detection — let the smoother hold its last estimate
          setSmoothedBox(smootherRef.current.current);
        }
        return;
      }

      if (msg.type === 'ERROR') {
        console.error('[useMediaPipeWorker] Worker error:', msg.message);
      }
    };

    worker.onerror = (e) => {
      console.error('[useMediaPipeWorker] Uncaught worker error:', e);
    };

    // Initialise the detector inside the worker
    worker.postMessage({ type: 'INIT', payload: { modelUrl } });
    workerRef.current = worker;

    return () => {
      // Explicit teardown — releases WASM heap and GPU buffers
      worker.postMessage({ type: 'DESTROY' });
      // Give the worker a tick to call detector.close() before terminating
      setTimeout(() => worker.terminate(), 50);
      workerRef.current = null;
      setIsReady(false);
    };
  }, [modelUrl]);

  const detectFrame = useCallback((bitmap: ImageBitmap, timestampMs: number) => {
    if (!workerRef.current || !isReady) {
      bitmap.close(); // Always release even if we skip
      return;
    }

    const now = performance.now();
    if (now - lastFrameTimeRef.current < minInterval) {
      bitmap.close(); // Throttled — release immediately
      return;
    }
    lastFrameTimeRef.current = now;

    // Transfer ownership of the bitmap to the worker (zero-copy)
    workerRef.current.postMessage(
      { type: 'DETECT_FRAME', payload: { imageBitmap: bitmap, timestampMs } },
      [bitmap] // Transferable
    );
  }, [isReady, minInterval]);

  const resetSmoother = useCallback(() => {
    smootherRef.current.reset();
    setSmoothedBox(null);
  }, []);

  return { isReady, latestDetections, smoothedBox, detectFrame, resetSmoother };
}
