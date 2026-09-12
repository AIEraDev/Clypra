import { useState, useEffect, useCallback, useRef } from "react";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { PLATFORM_PRESETS } from "./platformPresets";
import {
  renderTimelineFrameAt,
  compositeThumbnailCanvas,
  saveThumbnailDialog,
} from "./thumbnailExport";
import { computeThumbnailSeekTime } from "@/lib/media/thumbnailHeuristic";
import { generateId } from "@/lib/utils/id";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import type {
  CreatorThumbnail,
  ThumbnailPlatformPreset,
  ThumbnailOverlayLayer,
} from "@/types";

export function useThumbnailWorkspace() {
  const project = useProjectStore((s) => s.project);
  const addCreatorThumbnail = useProjectStore((s) => s.addCreatorThumbnail);
  const updateCreatorThumbnail = useProjectStore((s) => s.updateCreatorThumbnail);
  const removeCreatorThumbnail = useProjectStore((s) => s.removeCreatorThumbnail);

  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const transitions = useTimelineStore((s) => s.transitions);

  const existingThumbnails = project?.creatorThumbnails ?? [];

  // Active Variant State
  const [activeVariantId, setActiveVariantId] = useState<string>(() => {
    return existingThumbnails.length > 0 ? existingThumbnails[0].id : "";
  });

  const [activeVariant, setActiveVariant] = useState<CreatorThumbnail>(() => {
    if (existingThumbnails.length > 0) {
      return existingThumbnails[0];
    }
    const initialSeek = computeThumbnailSeekTime(project?.duration || 10);
    return {
      id: generateId("thumb"),
      label: "YouTube Thumbnail",
      timestampMs: Math.round(initialSeek * 1000),
      platformPreset: PLATFORM_PRESETS[0],
      overlayLayers: [
        {
          id: generateId("overlay"),
          kind: "text",
          text: project?.name?.toUpperCase() || "WATCH THIS",
          fontFamily: "Impact, Inter, system-ui",
          fontSize: 72,
          fontWeight: "900",
          color: "#ffffff",
          outlineColor: "#000000",
          outlineWidth: 8,
          shadowColor: "rgba(0,0,0,0.8)",
          shadowBlur: 16,
          x: 0.5,
          y: 0.85,
          opacity: 1,
          align: "center",
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  // Keep active variant synced when switching or when project changes
  useEffect(() => {
    if (existingThumbnails.length > 0) {
      const match = existingThumbnails.find((t) => t.id === activeVariantId);
      if (match) {
        setActiveVariant(match);
        return;
      }
      setActiveVariantId(existingThumbnails[0].id);
      setActiveVariant(existingThumbnails[0]);
    }
  }, [existingThumbnails, activeVariantId]);

  // Selected Overlay Layer for property editing
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() => {
    return activeVariant.overlayLayers[0]?.id || null;
  });

  // Preview & Render Status
  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isRenderingFrame, setIsRenderingFrame] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Render Base Frame when timestamp changes
  const renderRequestIdRef = useRef(0);

  const fetchBaseFrame = useCallback(
    async (timestampSec: number) => {
      if (!project) return;
      const reqId = ++renderRequestIdRef.current;
      setIsRenderingFrame(true);

      try {
        const canvas = await renderTimelineFrameAt({
          timestampSeconds: timestampSec,
          project,
          tracks,
          clips,
          mediaAssets: project.mediaAssets,
          transitions,
        });

        if (reqId === renderRequestIdRef.current) {
          setBaseCanvas(canvas);
        }
      } catch (err) {
        console.error("[useThumbnailWorkspace] Frame render error:", err);
      } finally {
        if (reqId === renderRequestIdRef.current) {
          setIsRenderingFrame(false);
        }
      }
    },
    [project, tracks, clips, transitions],
  );

  // Debounced trigger for base frame fetching
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBaseFrame(activeVariant.timestampMs / 1000);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeVariant.timestampMs, fetchBaseFrame]);

  // Composite Preview whenever baseCanvas, overlayLayers, or platformPreset changes
  useEffect(() => {
    const { width, height } = activeVariant.platformPreset;
    const composited = compositeThumbnailCanvas(
      baseCanvas,
      activeVariant.overlayLayers,
      width,
      height,
    );
    try {
      const url = composited.toDataURL("image/jpeg", 0.9);
      setPreviewDataUrl(url);
    } catch {
      // Ignored
    }
  }, [baseCanvas, activeVariant.overlayLayers, activeVariant.platformPreset]);

  // Persist Variant Helper
  const persistVariant = useCallback(
    (updated: CreatorThumbnail) => {
      setActiveVariant(updated);
      const exists = existingThumbnails.some((t) => t.id === updated.id);
      if (exists) {
        updateCreatorThumbnail(updated.id, updated);
      } else {
        addCreatorThumbnail(updated);
      }
    },
    [existingThumbnails, updateCreatorThumbnail, addCreatorThumbnail],
  );

  // Actions
  const setTimestamp = useCallback(
    (seconds: number) => {
      const ms = Math.max(0, Math.round(seconds * 1000));
      persistVariant({
        ...activeVariant,
        timestampMs: ms,
        updatedAt: Date.now(),
      });
    },
    [activeVariant, persistVariant],
  );

  const syncToCurrentPlayhead = useCallback(() => {
    try {
      const clock = getPlaybackClock();
      setTimestamp(clock.time || 0);
    } catch {
      setTimestamp(0);
    }
  }, [setTimestamp]);

  const setPlatformPreset = useCallback(
    (preset: ThumbnailPlatformPreset) => {
      persistVariant({
        ...activeVariant,
        platformPreset: preset,
        updatedAt: Date.now(),
      });
    },
    [activeVariant, persistVariant],
  );

  const addOverlayLayer = useCallback(
    (kind: "text" | "badge" = "text") => {
      const newLayer: ThumbnailOverlayLayer = {
        id: generateId("overlay"),
        kind,
        text: kind === "badge" ? "TOP SECRET" : "NEW TEXT",
        fontFamily: "Impact, Inter, system-ui",
        fontSize: Math.round(activeVariant.platformPreset.height * 0.08),
        fontWeight: "bold",
        color: "#ffffff",
        outlineColor: kind === "badge" ? undefined : "#000000",
        outlineWidth: kind === "badge" ? 0 : 6,
        backgroundColor: kind === "badge" ? "rgba(220, 38, 38, 0.95)" : undefined,
        backgroundPadding: 16,
        borderRadius: 8,
        x: 0.5,
        y: kind === "badge" ? 0.2 : 0.5,
        opacity: 1,
        align: "center",
      };

      persistVariant({
        ...activeVariant,
        overlayLayers: [...activeVariant.overlayLayers, newLayer],
        updatedAt: Date.now(),
      });
      setSelectedLayerId(newLayer.id);
    },
    [activeVariant, persistVariant],
  );

  const updateOverlayLayer = useCallback(
    (layerId: string, patch: Partial<ThumbnailOverlayLayer>) => {
      persistVariant({
        ...activeVariant,
        overlayLayers: activeVariant.overlayLayers.map((l) =>
          l.id === layerId ? { ...l, ...patch } : l,
        ),
        updatedAt: Date.now(),
      });
    },
    [activeVariant, persistVariant],
  );

  const removeOverlayLayer = useCallback(
    (layerId: string) => {
      persistVariant({
        ...activeVariant,
        overlayLayers: activeVariant.overlayLayers.filter((l) => l.id !== layerId),
        updatedAt: Date.now(),
      });
      if (selectedLayerId === layerId) {
        setSelectedLayerId(null);
      }
    },
    [activeVariant, persistVariant, selectedLayerId],
  );

  const createNewVariant = useCallback(
    (label?: string, preset?: ThumbnailPlatformPreset) => {
      const newThumb: CreatorThumbnail = {
        id: generateId("thumb"),
        label: label || `Variant ${String.fromCharCode(65 + existingThumbnails.length)}`,
        timestampMs: activeVariant.timestampMs,
        platformPreset: preset || activeVariant.platformPreset,
        overlayLayers: activeVariant.overlayLayers.map((l) => ({
          ...l,
          id: generateId("overlay"),
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addCreatorThumbnail(newThumb);
      setActiveVariantId(newThumb.id);
      setActiveVariant(newThumb);
      setSelectedLayerId(newThumb.overlayLayers[0]?.id || null);
    },
    [activeVariant, existingThumbnails.length, addCreatorThumbnail],
  );

  const deleteCurrentVariant = useCallback(
    (id: string) => {
      if (existingThumbnails.length <= 1) return; // Keep at least one
      removeCreatorThumbnail(id);
      const remaining = existingThumbnails.filter((t) => t.id !== id);
      if (remaining.length > 0) {
        setActiveVariantId(remaining[0].id);
        setActiveVariant(remaining[0]);
      }
    },
    [existingThumbnails, removeCreatorThumbnail],
  );

  const exportThumbnail = useCallback(
    async (format: "png" | "jpeg" = "png", quality = 95) => {
      setIsExporting(true);
      setExportMessage(null);

      try {
        const { width, height } = activeVariant.platformPreset;
        const composited = compositeThumbnailCanvas(
          baseCanvas,
          activeVariant.overlayLayers,
          width,
          height,
        );

        const defaultFileName = `${project?.name || "video"}-thumbnail-${activeVariant.platformPreset.kind}`;
        const savedPath = await saveThumbnailDialog(
          composited,
          defaultFileName,
          format,
          quality,
        );

        if (savedPath) {
          setExportMessage(`Saved to ${savedPath}`);
          // Also update exportedDataUrl cache on variant
          try {
            const dataUrl = composited.toDataURL("image/jpeg", 0.85);
            updateCreatorThumbnail(activeVariant.id, { exportedDataUrl: dataUrl });
          } catch {
            // Ignored
          }
        }
      } catch (err: any) {
        console.error("[useThumbnailWorkspace] Export failed:", err);
        setExportMessage(`Export failed: ${err?.message || String(err)}`);
      } finally {
        setIsExporting(false);
      }
    },
    [baseCanvas, activeVariant, project?.name, updateCreatorThumbnail],
  );

  return {
    project,
    activeVariant,
    variants: existingThumbnails.length > 0 ? existingThumbnails : [activeVariant],
    activeVariantId,
    setActiveVariantId: (id: string) => {
      setActiveVariantId(id);
      const match = existingThumbnails.find((t) => t.id === id);
      if (match) setActiveVariant(match);
    },
    selectedLayerId,
    setSelectedLayerId,
    previewDataUrl,
    isRenderingFrame,
    isExporting,
    exportMessage,
    setTimestamp,
    syncToCurrentPlayhead,
    setPlatformPreset,
    addOverlayLayer,
    updateOverlayLayer,
    removeOverlayLayer,
    createNewVariant,
    deleteCurrentVariant,
    exportThumbnail,
  };
}
