import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TextPreset {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  color: string;
  backgroundColor?: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing?: number;
  stroke?: {
    color: string;
    width: number;
  };
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  background?: {
    color: string;
    padding: number;
    borderRadius: number;
  };
  keyframes?: Record<string, any>;
  isCustom?: boolean;
}

const PRESET_DISPLAY_NAMES = new Map<TextPreset["id"], string>([
  ["preset-neon", "霓虹光效"],
  ["preset-minimal", "极简无衬线"],
  ["preset-editorial", "经典编辑风"],
  ["preset-subtitles", "高级字幕"],
]);

export const getPresetDisplayName = (preset: TextPreset): string =>
  preset.isCustom ? preset.name : PRESET_DISPLAY_NAMES.get(preset.id) ?? preset.name;

interface PresetStore {
  presets: TextPreset[];
  savePreset: (name: string, presetData: Omit<TextPreset, "id" | "name" | "isCustom">) => void;
  deletePreset: (id: string) => void;
}

const DEFAULT_PRESETS: TextPreset[] = [
  {
    id: "preset-neon",
    name: "Neon Glow",
    fontFamily: "Outfit Variable",
    fontSize: 48,
    fontWeight: "bold",
    color: "#ff007f",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    letterSpacing: 4,
    shadow: {
      color: "#ff007f",
      blur: 15,
      offsetX: 0,
      offsetY: 0,
    },
  },
  {
    id: "preset-minimal",
    name: "Minimalist Sans",
    fontFamily: "Inter Variable",
    fontSize: 36,
    fontWeight: "normal",
    color: "#ffffff",
    align: "center",
    valign: "middle",
    lineHeight: 1.4,
    letterSpacing: 1,
  },
  {
    id: "preset-editorial",
    name: "Classic Editorial",
    fontFamily: "Playfair Display Variable",
    fontSize: 54,
    fontWeight: "bold",
    fontStyle: "italic",
    color: "#f5f5f7",
    align: "center",
    valign: "middle",
    lineHeight: 1.1,
    letterSpacing: 0,
  },
  {
    id: "preset-subtitles",
    name: "Premium Subtitle",
    fontFamily: "Montserrat Variable",
    fontSize: 32,
    fontWeight: "bold",
    color: "#ffffff",
    align: "center",
    valign: "bottom",
    lineHeight: 1.2,
    letterSpacing: 1,
    stroke: {
      color: "#000000",
      width: 3,
    },
    background: {
      color: "rgba(0, 0, 0, 0.7)",
      padding: 12,
      borderRadius: 8,
    },
  },
];

export const usePresetStore = create<PresetStore>()(
  persist(
    (set) => ({
      presets: DEFAULT_PRESETS,

      savePreset: (name, presetData) => {
        set((state) => {
          const newPreset: TextPreset = {
            ...presetData,
            id: `custom-preset-${Date.now()}`,
            name,
            isCustom: true,
          };
          return {
            presets: [...state.presets, newPreset],
          };
        });
      },

      deletePreset: (id) => {
        set((state) => ({
          presets: state.presets.filter((p) => p.id !== id),
        }));
      },
    }),
    {
      name: "clypra-text-presets",
    }
  )
);
