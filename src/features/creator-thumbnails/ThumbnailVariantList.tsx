import React, { useState } from "react";
import type { CreatorThumbnail } from "@/types";
import { Plus, Copy, Trash2, Edit2, Check } from "lucide-react";

interface ThumbnailVariantListProps {
  variants: CreatorThumbnail[];
  activeVariantId: string;
  onSelectVariant: (id: string) => void;
  onCreateVariant: (label?: string) => void;
  onDeleteVariant: (id: string) => void;
  onUpdateVariant: (id: string, patch: Partial<CreatorThumbnail>) => void;
}

export const ThumbnailVariantList: React.FC<ThumbnailVariantListProps> = ({
  variants,
  activeVariantId,
  onSelectVariant,
  onCreateVariant,
  onDeleteVariant,
  onUpdateVariant,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const startRename = (v: CreatorThumbnail) => {
    setEditingId(v.id);
    setEditLabel(v.label);
  };

  const commitRename = (id: string) => {
    if (editLabel.trim()) {
      onUpdateVariant(id, { label: editLabel.trim() });
    }
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Variants ({variants.length})
        </label>
        <button
          type="button"
          onClick={() => onCreateVariant()}
          className="px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700 flex items-center gap-1 transition-colors"
          title="Create a new thumbnail variant"
        >
          <Plus className="w-3.5 h-3.5 text-sky-400" />
          New Variant
        </button>
      </div>

      <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto pr-1">
        {variants.map((variant) => {
          const isActive = variant.id === activeVariantId;

          return (
            <div
              key={variant.id}
              onClick={() => onSelectVariant(variant.id)}
              className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                isActive
                  ? "bg-sky-500/15 border-sky-500/80 text-sky-100 font-medium"
                  : "bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400">
                  {variant.platformPreset.aspectRatioLabel}
                </span>

                {editingId === variant.id ? (
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(variant.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="px-1.5 py-0.5 bg-neutral-800 border border-sky-500 rounded text-xs text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => commitRename(variant.id)}
                      className="text-sky-400 hover:text-sky-300 p-0.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="truncate">{variant.label}</span>
                )}
              </div>

              <div
                className="flex items-center gap-1 opacity-80 hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => startRename(variant)}
                  className="p-1 hover:text-neutral-200 text-neutral-500 rounded"
                  title="Rename variant"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                {variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteVariant(variant.id)}
                    className="p-1 hover:text-red-400 text-neutral-500 rounded"
                    title="Delete variant"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
