import React, { useState } from "react";
import { Sliders, Check, ChevronDown, Download } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import type { CanvasBackgroundConfig } from "@/types";
import { ClypraColorPicker } from "@clypra/ui-color-picker";

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
] as const;

// TODO: Replace with API call to Studio backend
// GET /api/v1/patterns?category=all&page=1&limit=50
// These are temporary mock patterns using CSS gradients
// Real implementation should fetch actual texture images from CDN
const PATTERN_PRESETS = [
  {
    id: "candy_cane",
    label: "Candy Cane",
    thumbnail:
      "repeating-linear-gradient(45deg, #ff6b6b 0, #ff6b6b 10px, #fff 10px, #fff 20px)",
  },
  {
    id: "snowman",
    label: "Snowman",
    thumbnail: "radial-gradient(circle, #8b4513 0%, #654321 100%)",
  },
  {
    id: "santa",
    label: "Santa",
    thumbnail: "linear-gradient(180deg, #c41e3a 0%, #8b0000 100%)",
  },
  {
    id: "blue_gradient",
    label: "Blue Gradient",
    thumbnail: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  },
  {
    id: "gingerbread",
    label: "Gingerbread",
    thumbnail: "linear-gradient(180deg, #0f4c3a 0%, #0a3a2a 100%)",
  },
  {
    id: "blocks",
    label: "Blocks",
    thumbnail:
      "linear-gradient(45deg, #f59e0b 25%, #d97706 25%, #d97706 50%, #f5f5f5 50%, #f5f5f5 75%, #e5e5e5 75%)",
  },
  {
    id: "plaid",
    label: "Plaid",
    thumbnail:
      "repeating-linear-gradient(90deg, #d4a574 0, #d4a574 40px, #8b7355 40px, #8b7355 80px)",
  },
  {
    id: "teal_pattern",
    label: "Teal Pattern",
    thumbnail: "radial-gradient(circle, #0d9488 0%, #0f766e 100%)",
  },
  {
    id: "navy_dots",
    label: "Navy Dots",
    thumbnail:
      "radial-gradient(circle at 20% 50%, #1e3a8a 2px, transparent 2px), radial-gradient(circle at 60% 50%, #1e3a8a 2px, transparent 2px), #0f1729",
  },
  {
    id: "black_grid",
    label: "Black Grid",
    thumbnail:
      "linear-gradient(90deg, #1a1a1a 1px, transparent 1px), linear-gradient(180deg, #1a1a1a 1px, transparent 1px), #000",
  },
  {
    id: "brown_diamonds",
    label: "Brown Diamonds",
    thumbnail:
      "repeating-linear-gradient(45deg, #78350f 0, #78350f 20px, #92400e 20px, #92400e 40px)",
  },
  {
    id: "beige_sparkle",
    label: "Beige Sparkle",
    thumbnail: "linear-gradient(135deg, #e7e5e4 0%, #d6d3d1 100%)",
  },
  {
    id: "pink_glitter",
    label: "Pink Glitter",
    thumbnail: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)",
  },
  {
    id: "purple_shimmer",
    label: "Purple Shimmer",
    thumbnail: "linear-gradient(135deg, #e9d5ff 0%, #d8b4fe 100%)",
  },
  {
    id: "ocean_wave",
    label: "Ocean Wave",
    thumbnail: "linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%)",
  },
  {
    id: "lavender_blur",
    label: "Lavender Blur",
    thumbnail: "linear-gradient(135deg, #e9d5ff 0%, #c4b5fd 100%)",
  },
  {
    id: "rose_blur",
    label: "Rose Blur",
    thumbnail: "linear-gradient(135deg, #fce7f3 0%, #f9a8d4 100%)",
  },
  {
    id: "cream_paper",
    label: "Cream Paper",
    thumbnail: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
  },
  {
    id: "coral_dots",
    label: "Coral Dots",
    thumbnail:
      "radial-gradient(circle at 30% 40%, #fca5a5 2px, transparent 2px), #fecaca",
  },
  {
    id: "cream_corner",
    label: "Cream Corner",
    thumbnail: "linear-gradient(135deg, #fef9c3 0%, #fef08a 100%)",
  },
  {
    id: "retro_black",
    label: "Retro Black",
    thumbnail: "linear-gradient(180deg, #000 0%, #171717 100%)",
  },
];

type CanvasMode = "none" | "blur" | "color" | "pattern";

const MODE_OPTIONS = [
  { value: "none" as const, label: "None" },
  { value: "blur" as const, label: "Blur" },
  { value: "color" as const, label: "Color" },
  { value: "pattern" as const, label: "Pattern" },
];

export const BackgroundInspectorPanel: React.FC = () => {
  const { project, updateProject } = useProjectStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedMode, setSelectedMode] = useState<CanvasMode>("pattern");
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);

  const bgConfig: CanvasBackgroundConfig = project?.canvasBackground || {
    type: "solid",
    color: "#0e0e12",
    opacity: 1,
    isTransparent: false,
  };

  const handleUpdate = (updates: Partial<CanvasBackgroundConfig>) => {
    if (!project) return;
    const newBg = { ...bgConfig, ...updates };
    updateProject({ canvasBackground: newBg });
  };

  const handleApplyToAll = () => {
    // TODO: Apply canvas background to all clips
    console.log("Apply canvas background to all clips");
  };

  // Get the currently selected video clip's first frame thumbnail
  React.useEffect(() => {
    const getVideoThumbnail = async () => {
      // TODO: Get the actual video thumbnail from the selected clip
      // For now, we'll use a placeholder
      // In a real implementation, you would:
      // 1. Get the selected clip from timelineStore
      // 2. Extract first frame using Tauri command or cached thumbnail
      // 3. Set it as the thumbnail
      setVideoThumbnail(null); // Will be replaced with actual thumbnail URL
    };

    getVideoThumbnail();
  }, [project]);

  return (
    <div className="space-y-3 text-xs select-none">
      {/* Canvas Header with Checkbox and Apply to All */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!bgConfig.isTransparent}
            onChange={() =>
              handleUpdate({ isTransparent: !bgConfig.isTransparent })
            }
            className="w-4 h-4 rounded border border-white/20 bg-[#1c1c1e] checked:bg-cyan-500 text-cyan-500 accent-cyan-500 focus:outline-none cursor-pointer"
          />
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              !bgConfig.isTransparent
                ? "text-white hover:text-white/80"
                : "text-white/40"
            }`}
          >
            Canvas
            <ChevronDown
              className={`w-4 h-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`}
            />
          </button>
        </div>
        <button
          onClick={handleApplyToAll}
          disabled={bgConfig.isTransparent}
          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
            !bgConfig.isTransparent
              ? "border-white/20 text-white hover:bg-white/5 cursor-pointer"
              : "border-white/10 text-white/30 cursor-not-allowed"
          }`}
        >
          Apply to all
        </button>
      </div>

      {/* Dropdown - Always visible when expanded */}
      {isExpanded && (
        <select
          value={selectedMode}
          onChange={(e) => {
            const mode = e.target.value as CanvasMode;
            setSelectedMode(mode);

            // Update background type accordingly
            if (mode === "none") handleUpdate({ isTransparent: true });
            else if (mode === "color")
              handleUpdate({ type: "solid", isTransparent: false });
            else if (mode === "pattern") handleUpdate({ isTransparent: false });
          }}
          disabled={bgConfig.isTransparent}
          className={`w-full px-3 py-2.5 rounded border text-sm focus:outline-none focus:border-white/30 ${
            !bgConfig.isTransparent
              ? "border-white/10 bg-[#2a2a2e] text-white cursor-pointer hover:border-white/20"
              : "border-white/5 bg-[#1a1a1e] text-white/30 cursor-not-allowed"
          }`}
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {/* Expanded Content */}
      {isExpanded && !bgConfig.isTransparent && (
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
              {[
                { id: "blur-0", label: "No Blur", blur: "0px" },
                { id: "blur-1", label: "Light Blur", blur: "8px" },
                { id: "blur-2", label: "Medium Blur", blur: "16px" },
                { id: "blur-3", label: "Heavy Blur", blur: "24px" },
              ].map((blurLevel) => (
                <button
                  key={blurLevel.id}
                  onClick={() => {
                    // TODO: Apply blur level
                    console.log("Apply blur:", blurLevel.id);
                  }}
                  className="relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-cyan-500/50 transition-all group"
                  title={blurLevel.label}
                >
                  {videoThumbnail ? (
                    // Show actual video thumbnail with blur applied
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `url(${videoThumbnail})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: `blur(${blurLevel.blur})`,
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
                        filter: `blur(${blurLevel.blur})`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
              ))}
            </div>
          )}

          {/* Pattern Grid View */}
          {selectedMode === "pattern" && (
            <div className="space-y-2">
              {/* TODO: Add loading state and error handling for API patterns */}
              {/* TODO: Add infinite scroll or pagination for large pattern libraries */}
              <div className="grid grid-cols-7 gap-2">
                {PATTERN_PRESETS.map((pattern) => (
                  <button
                    key={pattern.id}
                    onClick={() => {
                      // TODO: Apply pattern from API response
                      // Should store pattern.fullUrl in canvasBackground.mediaUrl
                      console.log("Apply pattern:", pattern.id);
                    }}
                    className="relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-cyan-500/50 transition-all group"
                    style={{ background: pattern.thumbnail }}
                    title={pattern.label}
                  >
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    <Download className="absolute bottom-1 right-1 w-3 h-3 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Color Mode */}
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

          {/* Pattern Mode shows gradient controls too (since patterns can be gradients) */}
          {selectedMode === "pattern" && bgConfig.type === "gradient" && (
            <div className="space-y-3 p-3 rounded-lg bg-[#2a2a2e] border border-white/10">
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">Gradient Type</span>
                <div className="flex gap-1 p-0.5 bg-[#1c1c1e] rounded border border-white/10">
                  <button
                    onClick={() =>
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          type: "linear",
                          stops: bgConfig.gradient?.stops || [
                            { color: "#1e1e2d", offset: 0 },
                            { color: "#000000", offset: 100 },
                          ],
                          angle: bgConfig.gradient?.angle || 135,
                        },
                      })
                    }
                    className={`px-2 py-1 rounded text-[10px] font-medium ${
                      bgConfig.gradient?.type !== "radial"
                        ? "bg-cyan-500 text-white"
                        : "text-white/60"
                    }`}
                  >
                    Linear
                  </button>
                  <button
                    onClick={() =>
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          type: "radial",
                          stops: bgConfig.gradient?.stops || [
                            { color: "#1e1e2d", offset: 0 },
                            { color: "#000000", offset: 100 },
                          ],
                        },
                      })
                    }
                    className={`px-2 py-1 rounded text-[10px] font-medium ${
                      bgConfig.gradient?.type === "radial"
                        ? "bg-cyan-500 text-white"
                        : "text-white/60"
                    }`}
                  >
                    Radial
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Start</span>
                  <ClypraColorPicker
                    value={bgConfig.gradient?.stops?.[0]?.color || "#1e1e2d"}
                    onChange={(c: string) => {
                      const stops = [
                        ...(bgConfig.gradient?.stops || [
                          { color: "#1e1e2d", offset: 0 },
                          { color: "#000000", offset: 100 },
                        ]),
                      ];
                      stops[0] = { ...stops[0], color: c };
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          ...bgConfig.gradient,
                          type: bgConfig.gradient?.type || "linear",
                          stops,
                        },
                      });
                    }}
                    onChangeComplete={(c: string) => {
                      const stops = [
                        ...(bgConfig.gradient?.stops || [
                          { color: "#1e1e2d", offset: 0 },
                          { color: "#000000", offset: 100 },
                        ]),
                      ];
                      stops[0] = { ...stops[0], color: c };
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          ...bgConfig.gradient,
                          type: bgConfig.gradient?.type || "linear",
                          stops,
                        },
                      });
                    }}
                    format="hex"
                    showAlpha={true}
                    size="sm"
                    triggerClassName="w-24 h-6.5 bg-[#1c1c1e] border-white/20 hover:border-white/30 shrink-0"
                    popoverClassName="right-0 left-auto mt-1 z-[100]"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">End</span>
                  <ClypraColorPicker
                    value={bgConfig.gradient?.stops?.[1]?.color || "#000000"}
                    onChange={(c: string) => {
                      const stops = [
                        ...(bgConfig.gradient?.stops || [
                          { color: "#1e1e2d", offset: 0 },
                          { color: "#000000", offset: 100 },
                        ]),
                      ];
                      stops[1] = { ...stops[1], color: c };
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          ...bgConfig.gradient,
                          type: bgConfig.gradient?.type || "linear",
                          stops,
                        },
                      });
                    }}
                    onChangeComplete={(c: string) => {
                      const stops = [
                        ...(bgConfig.gradient?.stops || [
                          { color: "#1e1e2d", offset: 0 },
                          { color: "#000000", offset: 100 },
                        ]),
                      ];
                      stops[1] = { ...stops[1], color: c };
                      handleUpdate({
                        type: "gradient",
                        gradient: {
                          ...bgConfig.gradient,
                          type: bgConfig.gradient?.type || "linear",
                          stops,
                        },
                      });
                    }}
                    format="hex"
                    showAlpha={true}
                    size="sm"
                    triggerClassName="w-24 h-6.5 bg-[#1c1c1e] border-white/20 hover:border-white/30 shrink-0"
                    popoverClassName="right-0 left-auto mt-1 z-[100]"
                  />
                </div>

                {bgConfig.gradient?.type !== "radial" && (
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-white/60">
                      <span>Angle</span>
                      <span>{bgConfig.gradient?.angle ?? 135}°</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={bgConfig.gradient?.angle ?? 135}
                      onChange={(e) =>
                        handleUpdate({
                          type: "gradient",
                          gradient: {
                            ...bgConfig.gradient,
                            type: "linear",
                            stops: bgConfig.gradient?.stops || [
                              { color: "#1e1e2d", offset: 0 },
                              { color: "#000000", offset: 100 },
                            ],
                            angle: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pattern Mode shows shader controls too (since shaders are animated patterns) */}
          {selectedMode === "pattern" && bgConfig.type === "shader" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {SHADER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() =>
                      handleUpdate({
                        type: "shader",
                        shader: {
                          presetId: preset.id,
                          speed: bgConfig.shader?.speed ?? 1.0,
                          intensity: bgConfig.shader?.intensity ?? 1.0,
                        },
                      })
                    }
                    className={`relative p-3 rounded-lg border transition-all overflow-hidden ${
                      bgConfig.shader?.presetId === preset.id
                        ? "border-cyan-500 ring-2 ring-cyan-500/30"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div
                      className="absolute inset-0 opacity-20"
                      style={{ background: preset.color }}
                    />
                    <div className="relative">
                      <div className="font-semibold text-[11px] text-white">
                        {preset.label}
                      </div>
                      <div className="text-[10px] text-white/60">
                        {preset.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="p-3 rounded-lg bg-[#2a2a2e] border border-white/10 space-y-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-white/60">
                    <span>Speed</span>
                    <span>{(bgConfig.shader?.speed ?? 1.0).toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={3.0}
                    step={0.1}
                    value={bgConfig.shader?.speed ?? 1.0}
                    onChange={(e) =>
                      handleUpdate({
                        type: "shader",
                        shader: {
                          presetId:
                            bgConfig.shader?.presetId || "liquid_aurora",
                          speed: Number(e.target.value),
                          intensity: bgConfig.shader?.intensity ?? 1.0,
                        },
                      })
                    }
                    className="w-full accent-cyan-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
