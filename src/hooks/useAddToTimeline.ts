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
import { useProjectStore } from "@/store/projectStore";

export function useAddToTimeline(): (item: any, type: string) => Promise<void> {
  return useCallback(
    async (item: any, type: string) => {
      const res = await TimelinePlacementEngine.addToTimeline({ item, type });
      if (!res.success && res.error) {
        console.warn(`[useAddToTimeline] Failed to add ${type} to timeline:`, res.error);
        useProjectStore.getState().showToast(res.error, "warning");
      }
    },
    [],
  );
}
