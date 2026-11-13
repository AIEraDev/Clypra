import type { TemplateTextProperties } from "@/features/text-templates/types";
import type { CaptionPresetSnapshot } from "@/types/captions";

export interface CaptionStylePreset {
  id: string;
  name: string;
  description: string;
  /** Full caption typography patch; timing and word animation remain renderer-owned. */
  textStyle: Partial<TemplateTextProperties>;
  /** Layout and per-word behavior consumed by the canonical caption renderer. */
  snapshot: Omit<CaptionPresetSnapshot, "id" | "version">;
  preview: {
    sampleText: string;
    activeWord: string;
    backgroundColor?: string;
  };
}

const currentWord = {
  mode: "current" as const,
  activeColor: "#FFE600",
  spokenColor: "#FFFFFF",
  upcomingColor: "rgba(255,255,255,0.58)",
  activeScale: 1.12,
};

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: "yellow-bold",
    name: "Punchy Highlight",
    description: "Bold social captions with a bright yellow active word and a strong dark outline.",
    textStyle: {
      text: "",
      fontFamily: "Outfit Variable",
      fontSize: 38,
      fontWeight: 900,
      color: "#FFFFFF",
      align: "center",
      verticalAlign: "bottom",
      lineHeight: 1.18,
      stroke: { color: "#000000", width: 4 },
      shadow: { color: "rgba(0,0,0,0.65)", blur: 6, offsetX: 0, offsetY: 3 },
    },
    snapshot: {
      position: "bottom",
      maxWidthPercent: 90,
      textTransform: "uppercase",
      wordHighlight: { ...currentWord },
    },
    preview: { sampleText: "MAKE IT", activeWord: "POP" },
  },
  {
    id: "classic-karaoke",
    name: "Classic Karaoke",
    description: "Clean white words with a yellow active-word highlight and cumulative spoken-word coloring.",
    textStyle: {
      text: "",
      fontFamily: "Montserrat",
      fontSize: 36,
      fontWeight: 800,
      color: "#FFFFFF",
      align: "center",
      verticalAlign: "bottom",
      lineHeight: 1.2,
      stroke: { color: "rgba(0,0,0,0.75)", width: 2 },
      shadow: { color: "rgba(0,0,0,0.55)", blur: 5, offsetX: 0, offsetY: 2 },
    },
    snapshot: {
      position: "bottom",
      maxWidthPercent: 88,
      textTransform: "none",
      wordHighlight: { ...currentWord, mode: "cumulative", activeColor: "#FACC15", spokenColor: "#FACC15" },
    },
    preview: { sampleText: "FOLLOW THE", activeWord: "RHYTHM" },
  },
  {
    id: "word-pop",
    name: "Word Pop",
    description: "A compact kinetic look that scales the active word without changing the caption's timing.",
    textStyle: {
      text: "",
      fontFamily: "Anton",
      fontSize: 42,
      fontWeight: 700,
      color: "#FFFFFF",
      align: "center",
      verticalAlign: "bottom",
      lineHeight: 1.1,
      shadow: { color: "rgba(0,0,0,0.7)", blur: 7, offsetX: 0, offsetY: 3 },
    },
    snapshot: {
      position: "bottom",
      maxWidthPercent: 84,
      textTransform: "uppercase",
      wordHighlight: {
        mode: "current",
        activeColor: "#FF4D8D",
        spokenColor: "#FFFFFF",
        upcomingColor: "rgba(255,255,255,0.55)",
        activeScale: 1.18,
        glowColor: "rgba(255,77,141,0.85)",
        glowBlur: 12,
      },
    },
    preview: { sampleText: "SAY IT", activeWord: "LOUD" },
  },
  {
    id: "minimal-clean",
    name: "Minimal",
    description: "Restrained editorial captions with a soft shadow and a subtle active-word tint.",
    textStyle: {
      text: "",
      fontFamily: "Inter Variable",
      fontSize: 31,
      fontWeight: 600,
      color: "#FFFFFF",
      align: "center",
      verticalAlign: "bottom",
      lineHeight: 1.25,
      shadow: { color: "rgba(0,0,0,0.72)", blur: 8, offsetX: 0, offsetY: 3 },
    },
    snapshot: {
      position: "bottom",
      maxWidthPercent: 86,
      textTransform: "none",
      wordHighlight: {
        mode: "current",
        activeColor: "#B8E1FF",
        spokenColor: "#FFFFFF",
        upcomingColor: "rgba(255,255,255,0.62)",
        activeScale: 1.04,
      },
    },
    preview: { sampleText: "A LITTLE", activeWord: "CLARITY" },
  },
  {
    id: "black-box",
    name: "Dark Box",
    description: "High-contrast white captions inside a rounded translucent dark panel.",
    textStyle: {
      text: "",
      fontFamily: "Inter Variable",
      fontSize: 33,
      fontWeight: 750,
      color: "#FFFFFF",
      align: "center",
      verticalAlign: "bottom",
      lineHeight: 1.2,
      background: { color: "rgba(0,0,0,0.82)", padding: 12, borderRadius: 12 },
    },
    snapshot: {
      position: "bottom",
      maxWidthPercent: 88,
      textTransform: "none",
      wordHighlight: {
        mode: "current",
        activeColor: "#76F7C5",
        spokenColor: "#FFFFFF",
        upcomingColor: "rgba(255,255,255,0.62)",
        activeScale: 1.08,
      },
    },
    preview: { sampleText: "READABLE", activeWord: "ANYWHERE", backgroundColor: "rgba(0,0,0,0.82)" },
  },
  {
    id: "neon-glow",
    name: "Neon Highlight",
    description: "Electric cyan typography with a blue active-word glow for gaming and tech content.",
    textStyle: {
      text: "",
      fontFamily: "Outfit Variable",
      fontSize: 38,
      fontWeight: 900,
      color: "#EAFBFF",
      align: "center",
      verticalAlign: "bottom",
      lineHeight: 1.16,
      stroke: { color: "#003B86", width: 2 },
      shadow: { color: "rgba(0,68,238,0.6)", blur: 10, offsetX: 0, offsetY: 0 },
    },
    snapshot: {
      position: "bottom",
      maxWidthPercent: 90,
      textTransform: "uppercase",
      wordHighlight: {
        mode: "current",
        activeColor: "#00F5FF",
        spokenColor: "#D8F7FF",
        upcomingColor: "rgba(216,247,255,0.48)",
        activeScale: 1.1,
        glowColor: "rgba(0,245,255,0.92)",
        glowBlur: 13,
      },
    },
    preview: { sampleText: "FUTURE", activeWord: "NOW" },
  },
];

export function getCaptionPresetById(id: string): CaptionStylePreset | undefined {
  return CAPTION_STYLE_PRESETS.find((preset) => preset.id === id);
}

export function createCaptionPresetSnapshot(
  preset: CaptionStylePreset,
): CaptionPresetSnapshot {
  return {
    id: preset.id,
    version: 1,
    position: preset.snapshot.position,
    maxWidthPercent: preset.snapshot.maxWidthPercent,
    textTransform: preset.snapshot.textTransform,
    wordHighlight: { ...preset.snapshot.wordHighlight },
  };
}
