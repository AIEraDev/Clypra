// src/features/text-effects/components/EffectPreview.tsx
import React, { useRef, useState } from "react";
import { useEffectsStore } from "../store/effectsStore";
import { useEffectCanvas } from "../hooks/useEffectCanvas";
import type { EffectFullDefinition } from "../types/types";
import { t } from "@/i18n";

interface EffectPreviewProps {
  onApply?: (text: string, effect: EffectFullDefinition) => void;
  onCancel?: () => void;
}

export function EffectPreview({ onApply, onCancel }: EffectPreviewProps) {
  const { selectedEffect, clearSelected } = useEffectsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [userText, setUserText] = useState("CLYPRA");

  useEffectCanvas(canvasRef, userText);

  if (!selectedEffect) return null;

  const handleCancel = () => {
    clearSelected();
    if (onCancel) onCancel();
  };

  const handleApply = () => {
    if (onApply) {
      onApply(userText, selectedEffect);
    }
    clearSelected();
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-surface-raised/40 border border-border/50 rounded-xl max-w-md mx-auto select-none">
      {/* ── Canvas preview ─────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden bg-black/60 aspect-3/1 border border-white/10 flex items-center justify-center">
        <canvas ref={canvasRef} width={600} height={200} className="w-full h-full object-contain block select-none pointer-events-none" />
      </div>

      {/* ── Text input ─────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">{t("features.textEffects.preview.label")}</label>
        <input value={userText} onChange={(e) => setUserText(e.target.value)} maxLength={30} placeholder={t("features.textEffects.preview.placeholder")} className="bg-surface-raised rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-gray-600 outline-none border border-border/50 focus:border-violet-500 transition-colors" />
      </div>

      {/* ── Actions ────────────────────────────────────────── */}
      <div className="flex gap-2.5 pt-1">
        <button onClick={handleCancel} className="flex-1 py-2.5 rounded-xl border border-border/50 text-sm font-semibold text-text-muted hover:text-text-primary hover:bg-surface-raised transition-all duration-200 cursor-pointer">
          {t("features.textEffects.preview.cancel")}
        </button>
        <button onClick={handleApply} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-all duration-200 cursor-pointer shadow-[0_4px_12px_rgba(108,99,255,0.2)] active:scale-[0.98]">
          {t("features.textEffects.preview.apply")}
        </button>
      </div>
    </div>
  );
}
