/**
 * useAddToTimeline
 *
 * Clean hook wrapper that delegates all timeline addition and placement
 * logic to the authoritative TimelinePlacementEngine.
 */

import { useCallback } from "react";
import {
  TimelinePlacementEngine,
  type TimelinePlacementOptions,
} from "@/lib/timeline/placementEngine";

export function useAddToTimeline(): (item: any, type: string) => Promise<void> {
  return useCallback(
    async (item: any, type: string) => {
      await TimelinePlacementEngine.addToTimeline({ item, type });
    },
    [],
  );
}
