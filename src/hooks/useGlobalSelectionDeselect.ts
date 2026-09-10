import { useEffect } from "react";
import { useUIStore } from "@/store/uiStore";
import {
  shouldClearSelectionOnPointerDown,
  clearEditorSelection,
} from "@/core/selection/selectionCoordinator";

/**
 * Hook that mounts a global listener for deselection on neutral editor space
 * and on the Escape key.
 *
 * This provides a desktop-standard deselection architecture where:
 * 1. Clicking neutral editor space (outside handles, canvas viewport, inputs, inspector)
 *    immediately clears the active selection and dismisses transform overlays.
 * 2. Pressing Escape blurs active inputs or clears active selection.
 */
export function useGlobalSelectionDeselect(): void {
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (shouldClearSelectionOnPointerDown(e.target, e.button)) {
        clearEditorSelection();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const isTyping =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);

        if (isTyping) {
          // If the user was typing in an input, blur it first to release focus
          target.blur();
          return;
        }

        const uiState = useUIStore.getState();
        const hasSelection =
          uiState.selectedClipIds.length > 0 ||
          uiState.selectedTrackId !== null ||
          uiState.selectedGapId !== null ||
          uiState.selectedTransitionId !== null;

        if (hasSelection) {
          e.preventDefault();
          clearEditorSelection();
        }
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);
}
