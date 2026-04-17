/**
 * Hook for loading waveform data from Tauri backend
 */

import { useEffect, useState, useRef } from "react";
import { getAudioWaveformPeaks } from "../../../lib/tauri";

interface UseWaveformResult {
  peaks: number[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads waveform peaks for an audio/video file
 * Cancels in-progress generation when source changes
 */
export function useWaveform(sourceMediaPath: string | null, enabled: boolean = true): UseWaveformResult {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Reset state when source changes
    setPeaks(null);
    setError(null);

    if (!sourceMediaPath || !enabled) {
      setLoading(false);
      return;
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const loadWaveform = async () => {
      setError(null);

      try {
        const waveformPeaks = await getAudioWaveformPeaks(sourceMediaPath, 1000);

        if (!abortController.signal.aborted) {
          setPeaks(waveformPeaks);
          setLoading(false);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          const errorMessage = err instanceof Error ? err.message : "Failed to generate waveform";
          setError(errorMessage);
          setLoading(false);
          console.warn("Waveform generation failed:", errorMessage);
        }
      }
    };

    loadWaveform();

    return () => {
      abortController.abort();
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    };
  }, [sourceMediaPath, enabled]);

  return { peaks, loading, error };
}
