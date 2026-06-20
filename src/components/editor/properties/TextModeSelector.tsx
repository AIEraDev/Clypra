import React from "react";
import { Type, Sparkles, Layout } from "lucide-react";
import { cn } from "@/lib/utils";

interface TextModeSelectorProps {
  mode: "plain" | "effect" | "template";
  onSwitch: (mode: "plain" | "effect" | "template") => void;
}

export const TextModeSelector: React.FC<TextModeSelectorProps> = ({
  mode,
  onSwitch,
}) => {
  return (
    <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-lg gap-1 mb-4 select-none">
      <button
        onClick={() => onSwitch("plain")}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-all duration-200",
          mode === "plain"
            ? "bg-zinc-850 text-white shadow-sm"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
        )}
      >
        <Type className="w-3.5 h-3.5" />
        <span>Plain Text</span>
      </button>
      
      <button
        onClick={() => onSwitch("effect")}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-all duration-200",
          mode === "effect"
            ? "bg-violet-600/20 text-violet-400 border border-violet-500/30 shadow-sm"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
        )}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Text Effect</span>
      </button>

      <button
        onClick={() => onSwitch("template")}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-all duration-200",
          mode === "template"
            ? "bg-amber-600/20 text-amber-400 border border-amber-500/30 shadow-sm"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
        )}
      >
        <Layout className="w-3.5 h-3.5" />
        <span>Template</span>
      </button>
    </div>
  );
};
