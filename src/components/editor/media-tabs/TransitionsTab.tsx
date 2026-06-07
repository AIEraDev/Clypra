import React, { useMemo, useState } from "react";
import { ArrowRight, Clock3, MoveRight, Plus, Search, Shuffle, Sparkles, ZoomIn, type LucideIcon } from "lucide-react";
import type { TabProps } from "./types";

const TRANSITION_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "essentials", label: "Essentials" },
  { id: "fade", label: "Fade" },
  { id: "motion", label: "Motion" },
  { id: "creative", label: "Creative" },
] as const;

type TransitionCategory = (typeof TRANSITION_CATEGORIES)[number]["id"];

interface TransitionPreset {
  id: string;
  name: string;
  duration: number;
  preview: "fade" | "dissolve" | "wipe" | "slide" | "zoom" | "spin" | "push" | "blur";
  category: Exclude<TransitionCategory, "all">;
  icon: LucideIcon;
  description: string;
  status: "ready" | "soon";
  swatch: string;
}

const TRANSITION_PRESETS: TransitionPreset[] = [
  { id: "trans-fade", name: "Fade", duration: 0.5, preview: "fade", description: "Clean opacity fade at the cut", category: "fade", icon: Shuffle, status: "ready", swatch: "from-zinc-950 via-zinc-600/40 to-white/20" },
  { id: "trans-dissolve", name: "Dissolve", duration: 1, preview: "dissolve", description: "Cross blend outgoing and incoming clips", category: "fade", icon: Sparkles, status: "ready", swatch: "from-cyan-400/30 via-white/20 to-fuchsia-400/30" },
  { id: "trans-wipe", name: "Wipe", duration: 0.8, preview: "wipe", description: "Directional reveal between clips", category: "motion", icon: ArrowRight, status: "soon", swatch: "from-emerald-400/35 to-slate-950" },
  { id: "trans-slide", name: "Slide", duration: 0.6, preview: "slide", description: "Slide one clip across the next", category: "motion", icon: MoveRight, status: "soon", swatch: "from-blue-400/35 to-violet-500/25" },
  { id: "trans-push", name: "Push", duration: 0.8, preview: "push", description: "Incoming clip pushes outgoing away", category: "motion", icon: MoveRight, status: "soon", swatch: "from-indigo-300/35 to-slate-900" },
  { id: "trans-zoom", name: "Zoom", duration: 0.7, preview: "zoom", description: "Scale through the edit point", category: "motion", icon: ZoomIn, status: "soon", swatch: "from-amber-300/35 to-rose-500/25" },
  { id: "trans-spin", name: "Spin", duration: 1, preview: "spin", description: "Rotational stylized handoff", category: "creative", icon: Sparkles, status: "soon", swatch: "from-purple-400/30 to-cyan-300/25" },
  { id: "trans-blur", name: "Blur", duration: 0.6, preview: "blur", description: "Defocus through the cut", category: "creative", icon: Shuffle, status: "soon", swatch: "from-sky-300/30 to-white/10" },
];

export const TransitionsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<TransitionCategory>("all");

  const filteredTransitions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return TRANSITION_PRESETS.filter((transition) => {
      const matchesCategory = activeCategory === "all" || transition.category === activeCategory || (activeCategory === "essentials" && transition.status === "ready");
      const matchesSearch = !query || transition.name.toLowerCase().includes(query) || transition.description.toLowerCase().includes(query) || transition.category.includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, activeCategory]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      <div className="flex items-center gap-2.5 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-sm bg-accent/10 border border-accent/20 text-accent-soft">
          <Shuffle className="w-3.5 h-3.5" />
          <span className="text-[12px] font-semibold">Transitions</span>
        </div>
        <div className="w-px h-5 bg-border/80 shrink-0" />
        <div className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          {TRANSITION_CATEGORIES.map((category) => (
            <button key={category.id} onClick={() => setActiveCategory(category.id)} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeCategory === category.id ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-1 border-b border-border/50 bg-surface/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search transitions..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised/70 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      <div className="grow overflow-y-auto scrollbar-thin p-2">
        {filteredTransitions.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-text-muted gap-1 text-xs">
            <Shuffle className="w-5 h-5" />
            <p>No matching transitions found</p>
            <p className="opacity-60">Try another category or search</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredTransitions.map((transition) => (
              <TransitionCard key={transition.id} transition={transition} onAddToTimeline={() => onAddToTimeline?.(transition, "transitions")} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TransitionCard: React.FC<{ transition: TransitionPreset; onAddToTimeline: () => void }> = ({ transition, onAddToTimeline }) => {
  const Icon = transition.icon;
  const isReady = transition.status === "ready";

  return (
    <button onClick={isReady ? onAddToTimeline : undefined} disabled={!isReady} className={`group text-left rounded-lg border bg-surface-raised/60 transition-all overflow-hidden ${isReady ? "border-border/50 hover:bg-surface-raised hover:border-accent/30 cursor-pointer" : "border-border/30 opacity-70 cursor-not-allowed"}`}>
      <div className={`h-16 bg-linear-to-r ${transition.swatch} relative overflow-hidden`}>
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded bg-black/45 border border-white/10" />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded bg-white/15 border border-white/15" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 rounded-full bg-black/35 border border-white/10 flex items-center justify-center backdrop-blur-sm">
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
        <span className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${isReady ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/20" : "bg-white/10 text-white/70 border border-white/10"}`}>{isReady ? "Ready" : "Soon"}</span>
      </div>
      <div className="p-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{transition.name}</p>
          {isReady ? <Plus className="w-3.5 h-3.5 text-text-muted group-hover:text-accent shrink-0 transition-colors" /> : <Clock3 className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-text-muted line-clamp-2">{transition.description}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] capitalize text-text-muted">{transition.category}</span>
          <span className="text-[10px] text-text-muted">{transition.duration.toFixed(1)}s</span>
        </div>
      </div>
    </button>
  );
};
