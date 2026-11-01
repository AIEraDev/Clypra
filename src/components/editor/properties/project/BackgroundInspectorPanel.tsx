import React, { useState } from "react";
import { Check } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import type { CanvasBackgroundConfig } from "@/types";
import { ClypraColorPicker } from "@clypra/ui-color-picker";
import { PropertySectionHeader } from "../primitives";
import { SliderTrack } from "../primitives/SliderTrack";
import { useVideoThumbnail } from "@/hooks/useVideoThumbnail";
import { useI18n } from "@/i18n";

const QUICK_COLORS = [
  "#000000",
  "#0e0e12",
  "#1e1e2d",
  "#ffffff",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
];

const SHADER_PRESETS = [
  {
    id: "liquid_aurora",
    label: "Liquid Aurora",
    desc: "Fluid glowing color waves",
    color: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  },
  {
    id: "neon_grid",
    label: "Neon Grid",
    desc: "Retro 80s synthwave perspective grid",
    color: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  },
  {
    id: "particle_dust",
    label: "Particle Wave",
    desc: "Floating ambient bokeh dust",
    color: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  },
  {
    id: "gradient_wave",
    label: "Gradient Pulse",
    desc: "Dynamic multi-color shifting mesh",
    color: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  },
];

// Two high-quality gradient patterns that apply via the existing gradient pipeline.
// Each entry carries both the CSS thumbnail string (for the preview swatch) and the
// full gradient config that is written to canvasBackground on click.
const QUALITY_PATTERNS = [
  {
    id: "amethyst",
    label: "Amethyst",
    desc: "Deep violet to indigo",
    thumbnail: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 50%, #6a11cb 100%)",
    gradient: {
      type: "linear" as const,
      stops: [
        { color: "#6a11cb", offset: 0 },
        { color: "#a18cd1", offset: 100 },
      ],
      angle: 135,
    },
  },
  {
    id: "golden-hour",
    label: "Golden Hour",
    desc: "Warm cinematic amber",
    thumbnail: "linear-gradient(135deg, #f7971e 0%, #ffd200 50%, #e8821a 100%)",
    gradient: {
      type: "linear" as const,
      stops: [
        { color: "#e8821a", offset: 0 },
        { color: "#ffd200", offset: 100 },
      ],
      angle: 135,
    },
  },
];

const BLUR_PRESETS = [
  { id: "blur-1", labelKey: "properties.canvas.blur.light",  blurRadius: 40  },
  { id: "blur-2", labelKey: "properties.canvas.blur.medium", blurRadius: 80  },
  { id: "blur-3", labelKey: "properties.canvas.blur.heavy",  blurRadius: 120 },
  { id: "blur-4", labelKey: "properties.canvas.blur.max",    blurRadius: 180 },
];

type CanvasMode = "none" | "blur" | "color" | "pattern";

const MODE_OPTION_KEYS = [
  { value: "none" as const, labelKey: "properties.canvas.backgroundMode.none" },
  { value: "blur" as const, labelKey: "properties.canvas.backgroundMode.blur" },
  {
    value: "color" as const,
    labelKey: "properties.canvas.backgroundMode.color",
  },
  {
    value: "pattern" as const,
    labelKey: "properties.canvas.backgroundMode.pattern",
  },
];

interface BackgroundInspectorPanelProps {
  selectedClipId?: string;
}

export const BackgroundInspectorPanel: React.FC<
  BackgroundInspectorPanelProps
> = ({ selectedClipId }) => {
  const { project, updateProject } = useProjectStore();
  const { t } = useI18n();
  const [isCanvasBackgroundCollapsed, setIsCanvasBackgroundCollapsed] =
    useState(false);

  const { thumbnailUrl } = useVideoThumbnail(selectedClipId);

  const bgConfig: CanvasBackgroundConfig = project?.canvasBackground || {
    type: "solid",
    color: "#0e0e12",
    opacity: 1,
    isTransparent: false,
  };

  // Derive selected mode from bgConfig — single source of truth from the store
  const selectedMode: CanvasMode = bgConfig.isTransparent
    ? "none"
    : bgConfig.type === "blur"
      ? "blur"
      : bgConfig.type === "solid"
        ? "color"
        : "pattern";

  const handleUpdate = (updates: Partial<CanvasBackgroundConfig>) => {
    if (!project) return;
    // Strip data: URLs from mediaUrl before persisting — the native compositor
    // derives the blur frame from videoPath; data URLs serve only the CSS preview
    // and must not be written to the project file (50-70 KB per preset click).
    const sanitized = { ...updates };
    if (
      typeof sanitized.mediaUrl === "string" &&
      sanitized.mediaUrl.startsWith("data:")
    ) {
      delete sanitized.mediaUrl;
    }
    const newBg = { ...bgConfig, ...sanitized };
    updateProject({ canvasBackground: newBg });
  };

  return (
    <div className="space-y-3 text-xs select-none">
      <PropertySectionHeader
        title={t("properties.canvas.title")}
        isCollapsed={!isCanvasBackgroundCollapsed}
        onToggleCollapse={() =>
          setIsCanvasBackgroundCollapsed(!isCanvasBackgroundCollapsed)
        }
        isKeyframe={false}
      />

      {/* Dropdown - Always visible when expanded */}
      {isCanvasBackgroundCollapsed && (
        <select
          value={selectedMode}
          onChange={(e) => {
            const mode = e.target.value as CanvasMode;
            if (mode === "none") handleUpdate({ isTransparent: true });
            else if (mode === "color")
              handleUpdate({ type: "solid", isTransparent: false });
            else if (mode === "pattern") handleUpdate({
                isTransparent: false,
                type: "gradient",
                gradient: QUALITY_PATTERNS[0].gradient,
              });
            else if (mode === "blur")
              handleUpdate({
                type: "blur",
                blurRadius: 80,
                isTransparent: false,
              });
          }}
          className="w-full px-3 py-2.5 rounded border text-sm focus:outline-none focus:border-white/30 border-white/5 bg-[#1a1a1e] text-white/30 cursor-pointer"
        >
          {MODE_OPTION_KEYS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      )}

      {/* Expanded Content */}
      {isCanvasBackgroundCollapsed && !bgConfig.isTransparent && (
        <div className="space-y-3">
          {/* None Mode - Show nothing */}
          {selectedMode === "none" && (
            <div className="p-4 text-center text-white/40 text-sm">
              No canvas background
            </div>
          )}

          {/* Blur Mode - Blur intensity levels */}
          {selectedMode === "blur" && (
            <div className="grid grid-cols-4 gap-2">
              {BLUR_PRESETS.map((blurLevel) => (
                <button
                  key={blurLevel.id}
                  onClick={() => {
                    handleUpdate({
                      type: "blur",
                      blurRadius: blurLevel.blurRadius,
                      mediaUrl: thumbnailUrl ?? undefined,
                      isTransparent: false,
                    });
                  }}
                  className={`relative aspect-square rounded-lg overflow-hidden border hover:border-cyan-500/50 transition-all group ${
                    bgConfig.type === "blur" &&
                    bgConfig.blurRadius === blurLevel.blurRadius
                      ? "border-cyan-500 ring-2 ring-cyan-500/30"
                      : "border-white/10"
                  }`}
                  title={t(blurLevel.labelKey)}
                >
                  {thumbnailUrl ? (
                    // Show actual video thumbnail with blur applied.
                    // Divide blurRadius by 12 to scale the canvas-space radius
                    // down to thumbnail-space (thumbnails are ~1/12 of canvas width).
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `url(${thumbnailUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: `blur(${(blurLevel.blurRadius / 12).toFixed(1)}px) brightness(0.85)`,
                      }}
                    />
                  ) : (
                    // Fallback placeholder when no video is selected
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100' height='100' fill='%23654321'/%3E%3Crect x='10' y='60' width='30' height='30' fill='%23ff6b35' rx='4'/%3E%3C/svg%3E\")",
                        backgroundSize: "cover",
                        filter: `blur(${(blurLevel.blurRadius / 12).toFixed(1)}px) brightness(0.85)`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
              ))}
            </div>
          )}

          {/* Pattern Mode — 2 quality gradient patterns */}
          {selectedMode === "pattern" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {QUALITY_PATTERNS.map((pattern) => {
                  const isActive =
                    bgConfig.type === "gradient" &&
                    bgConfig.gradient?.stops?.[0]?.color ===
                      pattern.gradient.stops[0].color &&
                    bgConfig.gradient?.stops?.[1]?.color ===
                      pattern.gradient.stops[1].color;
                  return (
                    <button
                      key={pattern.id}
                      onClick={() =>
                        handleUpdate({
                          type: "gradient",
                          gradient: pattern.gradient,
                          isTransparent: false,
                        })
                      }
                      className={`relative rounded-xl overflow-hidden border transition-all group h-20 ${
                        isActive
                          ? "border-cyan-500 ring-2 ring-cyan-500/30"
                          : "border-white/10 hover:border-white/30"
                      }`}
                      title={pattern.label}
                    >
                      {/* Full gradient fill */}
                      <div
                        className="absolute inset-0"
                        style={{ background: pattern.thumbnail }}
                      />
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
                      {/* Label */}
                      <div className="absolute bottom-0 inset-x-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent">
                        <div className="text-[10px] font-semibold text-white leading-tight">
                          {pattern.label}
                        </div>
                        <div className="text-[9px] text-white/60 leading-tight">
                          {pattern.desc}
                        </div>
                      </div>
                      {/* Active checkmark */}
                      {isActive && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Angle slider — only shown while a pattern gradient is active */}
              {bgConfig.type === "gradient" && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-white/50 text-[10px]">
                    <span>Angle</span>
                    <span>{bgConfig.gradient?.angle ?? 135}°</span>
                  </div>
                  <SliderTrack
                    value={bgConfig.gradient?.angle ?? 135}
                    min={0}
                    max={360}
                    onChange={(angle) =>
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          ...bgConfig.gradient,
                          type: bgConfig.gradient?.type || "linear",
                          stops: bgConfig.gradient?.stops || [
                            { color: "#6a11cb", offset: 0 },
                            { color: "#a18cd1", offset: 100 },
                          ],
                          angle,
                        },
                      })
                    }
                    propertyId="gradient-angle"
                  />
                </div>
              )}
            </div>
          )}
          {selectedMode === "color" && (
            <div className="space-y-3 p-3 rounded-lg bg-[#2a2a2e] border border-white/10">
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">Solid Color</span>
                <ClypraColorPicker
                  value={bgConfig.color || "#0e0e12"}
                  onChange={(c: string) =>
                    handleUpdate({ color: c, type: "solid" })
                  }
                  onChangeComplete={(c: string) =>
                    handleUpdate({ color: c, type: "solid" })
                  }
                  format="hex"
                  showAlpha={true}
                  size="sm"
                  triggerClassName="w-28 h-7 bg-[#1c1c1e] border-white/20 hover:border-white/30 shrink-0"
                  popoverClassName="right-0 left-auto mt-1 z-[100]"
                />
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_COLORS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => handleUpdate({ color: hex, type: "solid" })}
                    style={{ backgroundColor: hex }}
                    className={`w-6 h-6 rounded border transition-transform hover:scale-110 flex items-center justify-center ${
                      bgConfig.color?.toLowerCase() === hex.toLowerCase()
                        ? "border-cyan-500 ring-2 ring-cyan-500/30 scale-110"
                        : "border-white/20"
                    }`}
                  >
                    {bgConfig.color?.toLowerCase() === hex.toLowerCase() && (
                      <Check
                        className={`w-3 h-3 ${hex === "#ffffff" ? "text-black" : "text-white"}`}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};
