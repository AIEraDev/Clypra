/**
 * LUTSection.tsx
 *
 * 3D LUT selector in the Adjust › Basic tab.
 *
 * - Import .cube files via the Tauri file dialog
 * - Session-scoped LUT library (useLutStore)
 * - Intensity slider (0–100) and Protect Skin Tone toggle
 * - Selected lutId is written to clip.colorGrade so the IPC bridge picks it up
 */

import React, { useState, useCallback } from "react";
import { Upload, Trash2 } from "lucide-react";
import type { Clip } from "@/types";
import { isTauriRuntime } from "@/lib/platform/tauri";
import { useLutStore } from "@/store/lutStore";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";

interface LUTSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const LUTSection: React.FC<LUTSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const { entries, addEntry, removeEntry } = useLutStore();
  const [isImporting, setIsImporting] = useState(false);

  // Active LUT is stored on clip.colorGrade
  const colorGrade = selectedClip.colorGrade;
  const activeLutId: string = colorGrade?.lutId ?? "";
  const intensity = Math.round((colorGrade?.lutIntensity ?? 1) * 100);

  // Protect skin tone — stored in adjustments.lut (legacy path kept for compat)
  const adjustments = (selectedClip.adjustments ?? {}) as Record<string, any>;
  const protectSkinTone: boolean = adjustments?.lut?.protectSkinTone ?? true;

  const setActiveLut = useCallback(
    (id: string) => {
      if (!id) {
        // Deselect — clear colorGrade LUT fields
        handleUpdate("colorGrade", {
          ...colorGrade,
          lutId: undefined,
          hasLut: 0,
          lutIntensity: 1,
          lutSize: 33,
        });
        return;
      }
      const entry = entries.find((e) => e.id === id);
      handleUpdate("colorGrade", {
        ...colorGrade,
        lutId: id,
        hasLut: 1,
        lutIntensity: intensity / 100,
        lutSize: entry?.size ?? 33,
      });
    },
    [colorGrade, entries, handleUpdate, intensity],
  );

  const updateIntensity = useCallback(
    (newIntensity: number) => {
      handleUpdate("colorGrade", {
        ...colorGrade,
        lutIntensity: newIntensity / 100,
      });
    },
    [colorGrade, handleUpdate],
  );

  const toggleProtectSkinTone = useCallback(
    (enabled: boolean) => {
      handleUpdate("adjustments", {
        ...adjustments,
        lut: { ...(adjustments.lut ?? {}), protectSkinTone: enabled },
      });
    },
    [adjustments, handleUpdate],
  );

  const handleImport = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setIsImporting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "CUBE LUT", extensions: ["cube"] }],
        title: "Import LUT (.cube)",
      });
      if (!selected || typeof selected !== "string") return;

      // Derive id from file stem (stable within a session)
      const stem =
        selected
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.cube$/i, "") ?? "lut";
      const id = `lut-${stem.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<{ id: string; title: string; size: number }>(
        "load_lut_cube",
        { lutId: id, filePath: selected },
      );

      addEntry({
        id: info.id,
        name: info.title || stem,
        path: selected,
        size: info.size,
      });

      // Auto-select the imported LUT
      setActiveLut(info.id);
    } catch (err) {
      console.error("[LUTSection] Import failed:", err);
    } finally {
      setIsImporting(false);
    }
  }, [addEntry, setActiveLut]);

  const handleRemove = useCallback(
    (id: string) => {
      removeEntry(id);
      if (activeLutId === id) setActiveLut("");
    },
    [activeLutId, removeEntry, setActiveLut],
  );

  return (
    <div className="space-y-4">
      {/* Name row: dropdown + import button */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-white/60 min-w-[60px]">Name</label>
        <select
          value={activeLutId}
          onChange={(e) => setActiveLut(e.target.value)}
          className="flex-1 px-2 py-1.5 text-xs bg-[#2c2c2e] border border-white/10 rounded text-white/80 focus:outline-none focus:border-white/30 cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_6px_center] pr-6"
        >
          <option value="">None</option>
          {entries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        {/* Import .cube button */}
        <button
          type="button"
          onClick={handleImport}
          disabled={isImporting || !isTauriRuntime()}
          title="Import .cube LUT file"
          aria-label="Import LUT"
          className="flex items-center justify-center w-7 h-7 rounded bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>

        {/* Remove active LUT from library */}
        {activeLutId && (
          <button
            type="button"
            onClick={() => handleRemove(activeLutId)}
            title="Remove this LUT from library"
            aria-label="Remove LUT"
            className="flex items-center justify-center w-7 h-7 rounded bg-white/5 border border-white/10 text-white/50 hover:bg-red-500/20 hover:text-red-400 transition-colors cursor-pointer shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Intensity slider — only relevant when a LUT is active */}
      <div
        className={`flex items-center gap-2 ${!activeLutId ? "opacity-40 pointer-events-none" : ""}`}
      >
        <label className="text-xs text-white/60 min-w-[60px]">Intensity</label>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={intensity}
            min={0}
            max={100}
            step={1}
            disabled={!activeLutId}
            onChange={updateIntensity}
          />
          <NumericControl
            value={intensity}
            onChange={updateIntensity}
            step={1}
            min={0}
            max={100}
            inputWidth="w-12"
            suffix="%"
            decimals={0}
          />
        </div>
      </div>

      {/* Protect Skin Tone */}
      <div
        className={`flex items-start justify-between gap-4 ${!activeLutId ? "opacity-40 pointer-events-none" : ""}`}
      >
        <div className="flex-1">
          <div className="text-xs text-white/80 font-medium">
            Protect skin tone
          </div>
          <div className="text-[10px] text-white/40 mt-0.5">
            Reduces LUT impact on skin tones.
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={protectSkinTone}
            disabled={!activeLutId}
            onChange={(e) => toggleProtectSkinTone(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-[#48484a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500" />
        </label>
      </div>
    </div>
  );
};
