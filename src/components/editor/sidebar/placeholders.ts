import { Smile, Wand2, SlidersHorizontal, Shuffle, MessageSquare } from "lucide-react";
import type { FeaturePlaceholderProps } from "@/components/ui/FeaturePlaceholder";

const openExternalUrl = async (url: string) => {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.error("Tauri openUrl failed, falling back to window.open", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

/**
 * One config object per unfinished tab. When a tab's real panel ships,
 * delete its entry and the fallback below stops applying to it.
 */
export const SIDEBAR_PLACEHOLDERS: Record<string, FeaturePlaceholderProps> = {
  stickers: {
    icon: Smile,
    title: "Stickers are on the way",
    description: "Add animated stickers and emojis to your clips.",
    planned: [
      "Animated and static stickers",
      "Search by name or category",
      "Resize and rotate on the canvas",
    ],
    ghost: "grid",
    action: {
      label: "Follow progress",
      onClick: () => openExternalUrl("https://github.com/AIEraDev/Clypra"),
    },
  },
  effects: {
    icon: Wand2,
    title: "Effects are in development",
    description: "Apply visual effects to clips and tracks.",
    planned: [
      "Video effects with live preview",
      "Adjustable intensity and timing",
    ],
    ghost: "grid",
    action: {
      label: "Follow progress",
      onClick: () => openExternalUrl("https://github.com/AIEraDev/Clypra"),
    },
  },
  filters: {
    icon: SlidersHorizontal,
    title: "Filters are in development",
    description: "Colour looks you can apply in one click.",
    planned: ["Preset looks", "Intensity slider"],
    ghost: "grid",
    action: {
      label: "Follow progress",
      onClick: () => openExternalUrl("https://github.com/AIEraDev/Clypra"),
    },
  },
  transitions: {
    icon: Shuffle,
    title: "More transitions are coming",
    description: "Smooth cuts between clips.",
    status: "planned",
    ghost: "list",
    action: {
      label: "Follow progress",
      onClick: () => openExternalUrl("https://github.com/AIEraDev/Clypra"),
    },
  },
  captions: {
    icon: MessageSquare,
    title: "Captions are planned",
    description: "Generate and style subtitles for your video.",
    status: "planned",
    ghost: "list",
    action: {
      label: "Follow progress",
      onClick: () => openExternalUrl("https://github.com/AIEraDev/Clypra"),
    },
  },
};
