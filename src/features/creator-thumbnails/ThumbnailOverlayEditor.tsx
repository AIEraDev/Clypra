import React from "react";
import type { ThumbnailOverlayLayer } from "@/types";
import { Plus, Trash2, AlignLeft, AlignCenter, AlignRight, Type, ShieldAlert } from "lucide-react";

interface ThumbnailOverlayEditorProps {
  layers: ThumbnailOverlayLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onAddLayer: (kind: "text" | "badge") => void;
  onUpdateLayer: (id: string, patch: Partial<ThumbnailOverlayLayer>) => void;
  onRemoveLayer: (id: string) => void;
}

const FONTS = [
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Inter Bold", value: "Inter, sans-serif" },
  { label: "Anton", value: "Anton, sans-serif" },
  { label: "Montserrat", value: "Montserrat, sans-serif" },
  { label: "Oswald", value: "Oswald, sans-serif" },
  { label: "System UI", value: "system-ui, sans-serif" },
];

export const ThumbnailOverlayEditor: React.FC<ThumbnailOverlayEditorProps> = ({
  layers,
  selectedLayerId,
  onSelectLayer,
  onAddLayer,
  onUpdateLayer,
  onRemoveLayer,
}) => {
  const selectedLayer = layers.find((l) => l.id === selectedLayerId);

  return (
    <div className="flex flex-col gap-3">
      {/* Header & Layer Add Actions */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Overlay Layers ({layers.length})
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAddLayer("text")}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700 flex items-center gap-1 transition-colors"
          >
            <Type className="w-3.5 h-3.5 text-sky-400" />
            + Text
          </button>
          <button
            type="button"
            onClick={() => onAddLayer("badge")}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700 flex items-center gap-1 transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
            + Badge
          </button>
        </div>
      </div>

      {/* Layers List Chips */}
      {layers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-neutral-900/60 rounded-lg border border-neutral-800">
          {layers.map((layer, idx) => {
            const isSelected = layer.id === selectedLayerId;
            return (
              <div
                key={layer.id}
                onClick={() => onSelectLayer(layer.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer border transition-all ${
                  isSelected
                    ? "bg-sky-500/20 border-sky-500 text-sky-200 font-semibold"
                    : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <span className="truncate max-w-[120px]">
                  {layer.text || `Layer ${idx + 1}`}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveLayer(layer.id);
                  }}
                  className="hover:text-red-400 p-0.5 rounded"
                  title="Remove layer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Layer Properties Inspector */}
      {selectedLayer ? (
        <div className="flex flex-col gap-3 p-3 bg-neutral-900/70 rounded-xl border border-neutral-800">
          {/* Text Input */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral-400">Content</span>
            <input
              type="text"
              value={selectedLayer.text}
              onChange={(e) => onUpdateLayer(selectedLayer.id, { text: e.target.value })}
              placeholder="Headline text..."
              className="w-full px-2.5 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:border-sky-500 font-bold"
            />
          </div>

          {/* Typography: Font & Alignment */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral-400">Font Family</span>
              <select
                value={selectedLayer.fontFamily}
                onChange={(e) => onUpdateLayer(selectedLayer.id, { fontFamily: e.target.value })}
                className="px-2 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-none focus:border-sky-500"
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral-400">Alignment</span>
              <div className="flex items-center gap-1 bg-neutral-800 p-0.5 rounded-lg border border-neutral-700">
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    type="button"
                    onClick={() => onUpdateLayer(selectedLayer.id, { align })}
                    className={`flex-1 py-1 rounded flex items-center justify-center ${
                      selectedLayer.align === align
                        ? "bg-neutral-700 text-sky-400 shadow-sm"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {align === "left" && <AlignLeft className="w-3.5 h-3.5" />}
                    {align === "center" && <AlignCenter className="w-3.5 h-3.5" />}
                    {align === "right" && <AlignRight className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Colors: Text, Stroke & Background */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral-400">Text Color</span>
              <div className="flex items-center gap-1.5 bg-neutral-800 p-1 rounded-lg border border-neutral-700">
                <input
                  type="color"
                  value={selectedLayer.color || "#ffffff"}
                  onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })}
                  className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="text-[10px] font-mono text-neutral-300 truncate">
                  {selectedLayer.color}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral-400">Stroke Color</span>
              <div className="flex items-center gap-1.5 bg-neutral-800 p-1 rounded-lg border border-neutral-700">
                <input
                  type="color"
                  value={selectedLayer.outlineColor || "#000000"}
                  onChange={(e) => onUpdateLayer(selectedLayer.id, { outlineColor: e.target.value })}
                  className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="text-[10px] font-mono text-neutral-300 truncate">
                  {selectedLayer.outlineColor || "None"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-neutral-400">Badge Bg</span>
              <div className="flex items-center gap-1.5 bg-neutral-800 p-1 rounded-lg border border-neutral-700">
                <input
                  type="color"
                  value={selectedLayer.backgroundColor?.startsWith("#") ? selectedLayer.backgroundColor : "#dc2626"}
                  onChange={(e) =>
                    onUpdateLayer(selectedLayer.id, {
                      backgroundColor: e.target.value,
                      kind: "badge",
                    })
                  }
                  className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="text-[10px] font-mono text-neutral-300 truncate">
                  {selectedLayer.backgroundColor ? "Set" : "None"}
                </span>
              </div>
            </div>
          </div>

          {/* Size & Stroke Width Sliders */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Font Size</span>
                <span className="font-mono">{selectedLayer.fontSize || 60}px</span>
              </div>
              <input
                type="range"
                min={24}
                max={160}
                value={selectedLayer.fontSize || 60}
                onChange={(e) =>
                  onUpdateLayer(selectedLayer.id, { fontSize: parseInt(e.target.value, 10) })
                }
                className="w-full h-1.5 bg-neutral-800 rounded accent-sky-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Stroke Width</span>
                <span className="font-mono">{selectedLayer.outlineWidth ?? 0}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={24}
                value={selectedLayer.outlineWidth ?? 0}
                onChange={(e) =>
                  onUpdateLayer(selectedLayer.id, { outlineWidth: parseInt(e.target.value, 10) })
                }
                className="w-full h-1.5 bg-neutral-800 rounded accent-sky-500"
              />
            </div>
          </div>

          {/* Position Sliders (X & Y) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Position X</span>
                <span className="font-mono">{Math.round(selectedLayer.x * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedLayer.x}
                onChange={(e) =>
                  onUpdateLayer(selectedLayer.id, { x: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 bg-neutral-800 rounded accent-sky-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Position Y</span>
                <span className="font-mono">{Math.round(selectedLayer.y * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedLayer.y}
                onChange={(e) =>
                  onUpdateLayer(selectedLayer.id, { y: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 bg-neutral-800 rounded accent-sky-500"
              />
            </div>
          </div>

          {/* Rotation & Opacity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Rotation</span>
                <span className="font-mono">{selectedLayer.rotation ?? 0}°</span>
              </div>
              <input
                type="range"
                min={-45}
                max={45}
                value={selectedLayer.rotation ?? 0}
                onChange={(e) =>
                  onUpdateLayer(selectedLayer.id, { rotation: parseInt(e.target.value, 10) })
                }
                className="w-full h-1.5 bg-neutral-800 rounded accent-sky-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>Opacity</span>
                <span className="font-mono">
                  {Math.round((selectedLayer.opacity ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selectedLayer.opacity ?? 1}
                onChange={(e) =>
                  onUpdateLayer(selectedLayer.id, { opacity: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 bg-neutral-800 rounded accent-sky-500"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-dashed border-neutral-800 text-center text-xs text-neutral-500">
          No overlay layer selected. Click "+ Text" or select a layer to edit.
        </div>
      )}
    </div>
  );
};
