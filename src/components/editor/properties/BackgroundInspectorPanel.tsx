import React from "react";
import { Palette, Sparkles, Sliders, EyeOff, Check } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import type { CanvasBackgroundConfig } from "@/types";

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
  { id: "liquid_aurora", label: "Liquid Aurora", desc: "Fluid glowing color waves" },
  { id: "neon_grid", label: "Neon Grid", desc: "Retro 80s synthwave perspective grid" },
  { id: "particle_dust", label: "Particle Wave", desc: "Floating ambient bokeh dust" },
  { id: "gradient_wave", label: "Gradient Pulse", desc: "Dynamic multi-color shifting mesh" },
] as const;

export const BackgroundInspectorPanel: React.FC = () => {
  const { project, updateProject } = useProjectStore();

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

  return (
    <div className="space-y-4 text-xs select-none p-3">
      {/* Mode Selector */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-text-secondary flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-accent" />
          Canvas Background Mode
        </label>
        <div className="grid grid-cols-4 gap-1.5 p-1 bg-surface-raised/60 rounded-lg border border-border/40">
          {(["solid", "gradient", "shader", "media"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleUpdate({ type: mode, isTransparent: false })}
              className={`py-1.5 px-2 rounded-md font-medium capitalize text-center transition-all ${
                bgConfig.type === mode && !bgConfig.isTransparent
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-raised"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Transparent Canvas Toggle */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-raised/40 border border-border/30">
        <div className="flex items-center gap-2">
          <EyeOff className="w-3.5 h-3.5 text-text-muted" />
          <div>
            <p className="font-medium text-text-primary">Transparent Canvas</p>
            <p className="text-[10px] text-text-muted">Alpha background for PNG/Overlays</p>
          </div>
        </div>
        <button
          onClick={() => handleUpdate({ isTransparent: !bgConfig.isTransparent })}
          className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
            bgConfig.isTransparent ? "bg-accent" : "bg-surface-raised border border-border"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform ${
              bgConfig.isTransparent ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {!bgConfig.isTransparent && (
        <>
          {/* Solid Color Mode */}
          {bgConfig.type === "solid" && (
            <div className="space-y-3 p-3 rounded-xl bg-surface-raised/30 border border-border/40">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-secondary">Solid Color</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgConfig.color || "#0e0e12"}
                    onChange={(e) => handleUpdate({ color: e.target.value })}
                    className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={bgConfig.color || "#0e0e12"}
                    onChange={(e) => handleUpdate({ color: e.target.value })}
                    className="w-20 px-2 py-1 rounded bg-surface border border-border/60 font-mono text-[11px] uppercase text-text-primary"
                  />
                </div>
              </div>

              {/* Swatches */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_COLORS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => handleUpdate({ color: hex })}
                    style={{ backgroundColor: hex }}
                    className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 flex items-center justify-center ${
                      bgConfig.color?.toLowerCase() === hex.toLowerCase()
                        ? "border-accent ring-2 ring-accent/30 scale-110"
                        : "border-border/60"
                    }`}
                  >
                    {bgConfig.color?.toLowerCase() === hex.toLowerCase() && (
                      <Check className={`w-3 h-3 ${hex === "#ffffff" ? "text-black" : "text-white"}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Gradient Mode */}
          {bgConfig.type === "gradient" && (
            <div className="space-y-3 p-3 rounded-xl bg-surface-raised/30 border border-border/40">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-secondary">Gradient Type</span>
                <div className="flex gap-1 p-0.5 bg-surface rounded-md border border-border">
                  <button
                    onClick={() =>
                      handleUpdate({
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
                      bgConfig.gradient?.type !== "radial" ? "bg-accent text-white" : "text-text-muted"
                    }`}
                  >
                    Linear
                  </button>
                  <button
                    onClick={() =>
                      handleUpdate({
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
                      bgConfig.gradient?.type === "radial" ? "bg-accent text-white" : "text-text-muted"
                    }`}
                  >
                    Radial
                  </button>
                </div>
              </div>

              {/* Gradient Color Stops */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Start Color</span>
                  <input
                    type="color"
                    value={bgConfig.gradient?.stops?.[0]?.color || "#1e1e2d"}
                    onChange={(e) => {
                      const stops = [...(bgConfig.gradient?.stops || [{ color: "#1e1e2d", offset: 0 }, { color: "#000000", offset: 100 }])];
                      stops[0] = { ...stops[0], color: e.target.value };
                      handleUpdate({ gradient: { ...bgConfig.gradient, type: bgConfig.gradient?.type || "linear", stops } });
                    }}
                    className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">End Color</span>
                  <input
                    type="color"
                    value={bgConfig.gradient?.stops?.[1]?.color || "#000000"}
                    onChange={(e) => {
                      const stops = [...(bgConfig.gradient?.stops || [{ color: "#1e1e2d", offset: 0 }, { color: "#000000", offset: 100 }])];
                      stops[1] = { ...stops[1], color: e.target.value };
                      handleUpdate({ gradient: { ...bgConfig.gradient, type: bgConfig.gradient?.type || "linear", stops } });
                    }}
                    className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0"
                  />
                </div>

                {bgConfig.gradient?.type !== "radial" && (
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-text-muted">
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
                      className="w-full accent-accent"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Animated Shader Mode */}
          {bgConfig.type === "shader" && (
            <div className="space-y-3 p-3 rounded-xl bg-surface-raised/30 border border-border/40">
              <div className="flex items-center gap-1.5 text-accent font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                Animated Shader Presets
              </div>

              <div className="space-y-1.5">
                {SHADER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() =>
                      handleUpdate({
                        shader: {
                          presetId: preset.id,
                          speed: bgConfig.shader?.speed ?? 1.0,
                          intensity: bgConfig.shader?.intensity ?? 1.0,
                        },
                      })
                    }
                    className={`w-full text-left p-2 rounded-lg border transition-all ${
                      bgConfig.shader?.presetId === preset.id
                        ? "bg-accent/10 border-accent text-accent font-medium"
                        : "bg-surface/50 border-border/40 hover:bg-surface text-text-primary"
                    }`}
                  >
                    <div className="font-semibold text-[11px]">{preset.label}</div>
                    <div className="text-[10px] text-text-muted">{preset.desc}</div>
                  </button>
                ))}
              </div>

              {/* Speed & Intensity */}
              <div className="space-y-2 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <div className="flex justify-between text-text-muted">
                    <span>Animation Speed</span>
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
                        shader: {
                          presetId: bgConfig.shader?.presetId || "liquid_aurora",
                          speed: Number(e.target.value),
                          intensity: bgConfig.shader?.intensity ?? 1.0,
                        },
                      })
                    }
                    className="w-full accent-accent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Opacity Slider */}
          <div className="space-y-1.5 p-3 rounded-xl bg-surface-raised/30 border border-border/40">
            <div className="flex justify-between font-medium text-text-secondary">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-text-muted" />
                Background Opacity
              </span>
              <span>{Math.round((bgConfig.opacity ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={bgConfig.opacity ?? 1}
              onChange={(e) => handleUpdate({ opacity: Number(e.target.value) })}
              className="w-full accent-accent"
            />
          </div>
        </>
      )}
    </div>
  );
};
