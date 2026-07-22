/**
 * Split Mode Hook
 *
 * Manages split mode interactions:
 * - Visual feedback (cursor, hover states)
 * - Click-to-split behavior
 * - Mode activation/deactivation
 *
 * When split mode is active:
 * - Cursor changes to scissors over clips
 * - Clicking a clip splits it at that position
 * - Hover shows split preview line
 */

import { useEffect } from "react";
import { EditingActions } from "../core/interactions";
import { t } from "@/i18n";

interface UseSplitModeOptions {
  /** Whether split mode is active */
  enabled: boolean;
  /** Callback when split is executed */
  onSplit?: (clipId: string, time: number) => void;
  /** Callback for toast messages */
  onMessage?: (message: string) => void;
}

export const useSplitMode = ({ enabled, onSplit, onMessage }: UseSplitModeOptions) => {
  useEffect(() => {
    if (!enabled) return;

    const container = document.getElementById("timeline-tracks-container");
    if (!container) return;

    let activePreviewClip: HTMLElement | null = null;
    let previewLine: HTMLDivElement | null = null;

    const removePreview = () => {
      if (previewLine?.parentElement) {
        previewLine.parentElement.removeChild(previewLine);
      }
      previewLine = null;
      activePreviewClip = null;
    };

    const ensurePreview = (clipElement: HTMLElement) => {
      if (activePreviewClip === clipElement && previewLine) return;
      removePreview();
      activePreviewClip = clipElement;
      previewLine = document.createElement("div");
      previewLine.setAttribute("data-split-preview-line", "true");
      previewLine.style.position = "absolute";
      previewLine.style.top = "0";
      previewLine.style.bottom = "0";
      previewLine.style.width = "1px";
      previewLine.style.background = "var(--color-accent)";
      previewLine.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.35)";
      previewLine.style.pointerEvents = "none";
      previewLine.style.zIndex = "80";
      clipElement.appendChild(previewLine);
    };

    const updatePreviewPosition = (clipElement: HTMLElement, clientX: number) => {
      ensurePreview(clipElement);
      if (!previewLine) return;
      const rect = clipElement.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      previewLine.style.left = `${x}px`;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const clipElement = target?.closest("[data-clip-id]") as HTMLElement | null;
      if (!clipElement || !container.contains(clipElement)) {
        removePreview();
        return;
      }
      updatePreviewPosition(clipElement, e.clientX);
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const clipElement = target.closest("[data-clip-id]") as HTMLElement | null;

      if (!clipElement) return;
      if (!container.contains(clipElement)) return;
      if (target.closest('[data-testid*="resize"]')) return;

      const clipId = clipElement.getAttribute("data-clip-id");
      if (!clipId) return;

      e.preventDefault();
      e.stopPropagation();

      // Calculate click position in timeline time
      const rect = clipElement.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const clipWidth = rect.width;

      // Get clip data to calculate time
      const clipStartAttr = clipElement.getAttribute("data-clip-start");
      const clipDurationAttr = clipElement.getAttribute("data-clip-duration");

      if (!clipStartAttr || !clipDurationAttr) {
        // Fallback: split at center if attributes missing
        console.warn("[SplitMode] Clip attributes missing, cannot calculate split time");
        return;
      }

      const clipStart = parseFloat(clipStartAttr);
      const clipDuration = parseFloat(clipDurationAttr);
      const clickRatio = clickX / clipWidth;
      const splitTime = clipStart + clipDuration * clickRatio;

      // Execute split
      const result = EditingActions.splitAtPosition(clipId, splitTime);

      if (result.success) {
        onSplit?.(clipId, splitTime);
        onMessage?.(t("timeline.message.clipSplit", { time: splitTime.toFixed(2) }));
      } else {
        onMessage?.(result.error || t("timeline.message.splitFailed"));
      }
    };

    // Timeline-scoped pointer listeners in capture phase so razor takes priority
    // over clip drag/select handlers while tool is active.
    container.addEventListener("pointermove", handlePointerMove, true);
    container.addEventListener("pointerdown", handlePointerDown, true);

    // Change cursor when hovering over clips
    const style = document.createElement("style");
    style.id = "split-mode-cursor";
    style.textContent = `
      #timeline-tracks-container [data-clip-id] {
        cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"/></svg>') 12 12, crosshair !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      container.removeEventListener("pointermove", handlePointerMove, true);
      container.removeEventListener("pointerdown", handlePointerDown, true);
      removePreview();
      const styleElement = document.getElementById("split-mode-cursor");
      if (styleElement) {
        styleElement.remove();
      }
    };
  }, [enabled, onSplit, onMessage]);

  return {
    enabled,
  };
};
