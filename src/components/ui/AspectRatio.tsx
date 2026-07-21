import { cn } from "@/lib/utils";
import { AspectRatio, PREVIEW_ASPECT_MESSAGE_KEY } from "@/types";
import { t } from "@/i18n";
import { Check } from "lucide-react";
import React from "react";

export const AspectMenuRow = ({ preset, selected, onSelect, icon, disabled }: { preset: AspectRatio; selected: AspectRatio; onSelect: (p: AspectRatio) => void; icon: React.ReactNode; disabled?: boolean }) => {
  const isSel = selected === preset;
  const label = t(PREVIEW_ASPECT_MESSAGE_KEY[preset]);
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSel}
      disabled={disabled}
      title={label}
      className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised", isSel && "bg-surface-raised", disabled && "cursor-not-allowed opacity-45 hover:bg-transparent")}
      onClick={() => {
        if (!disabled) onSelect(preset);
      }}
    >
      <span className="flex w-5 shrink-0 justify-center">{isSel ? <Check className="h-3.5 w-3.5 text-accent" /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
};
