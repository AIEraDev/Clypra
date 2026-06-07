import React, { useMemo, useState } from "react";
import { Aperture, CircleDot, Grid3X3, Palette, Plus, Search, SlidersHorizontal, Sparkles, Sun, Wand2, Zap, type LucideIcon } from "lucide-react";
import type { TabProps } from "./types";

const EFFECT_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "essentials", label: "Essentials" },
  { id: "color", label: "Color" },
  { id: "light", label: "Light" },
  { id: "stylize", label: "Stylize" },
  { id: "distort", label: "Distort" },
] as const;

type EffectCategory = (typeof EFFECT_CATEGORIES)[number]["id"];
type EffectStatusFilter = "all" | "ready" | "soon";
type EffectStrengthFilter = "all" | "subtle" | "medium" | "strong";

interface EffectPreset {
  id: string;
  name: string;
  category: Exclude<EffectCategory, "all">;
  icon: LucideIcon;
  description: string;
  strength: "Subtle" | "Medium" | "Strong";
  status: "ready" | "soon";
  swatch: string;
}

const EFFECT_PRESETS: EffectPreset[] = [
  { id: "fx-blur", name: "Soft Blur", category: "essentials", icon: Aperture, description: "Smooth Gaussian defocus", strength: "Medium", status: "soon", swatch: "from-sky-400/45 to-white/10" },
  { id: "fx-sharpen", name: "Sharpen", category: "essentials", icon: SlidersHorizontal, description: "Recover edge detail", strength: "Subtle", status: "soon", swatch: "from-zinc-200/45 to-zinc-700/30" },
  { id: "fx-vignette", name: "Vignette", category: "essentials", icon: CircleDot, description: "Guide attention inward", strength: "Medium", status: "soon", swatch: "from-black/60 to-white/10" },
  { id: "fx-brightness", name: "Brightness", category: "color", icon: Sun, description: "Lift or lower exposure", strength: "Subtle", status: "soon", swatch: "from-yellow-300/50 to-white/20" },
  { id: "fx-contrast", name: "Contrast", category: "color", icon: SlidersHorizontal, description: "Shape tonal depth", strength: "Medium", status: "soon", swatch: "from-white/50 via-zinc-600/40 to-black/50" },
  { id: "fx-saturation", name: "Saturation", category: "color", icon: Palette, description: "Control color intensity", strength: "Medium", status: "soon", swatch: "from-fuchsia-400/45 via-emerald-300/35 to-cyan-400/35" },
  { id: "fx-glow", name: "Glow", category: "light", icon: Sparkles, description: "Bloom bright highlights", strength: "Strong", status: "soon", swatch: "from-pink-400/45 to-amber-200/25" },
  { id: "fx-light-leak", name: "Light Leak", category: "light", icon: Zap, description: "Analog flare wash", strength: "Medium", status: "soon", swatch: "from-orange-400/50 to-rose-300/20" },
  { id: "fx-film-grain", name: "Film Grain", category: "stylize", icon: Grid3X3, description: "Fine texture overlay", strength: "Subtle", status: "soon", swatch: "from-stone-300/30 to-zinc-800/40" },
  { id: "fx-chromatic", name: "Chromatic", category: "stylize", icon: Wand2, description: "Controlled RGB edge split", strength: "Medium", status: "soon", swatch: "from-red-400/40 via-green-300/30 to-blue-400/40" },
  { id: "fx-pixelate", name: "Pixelate", category: "distort", icon: Grid3X3, description: "Blocky mosaic sampling", strength: "Strong", status: "soon", swatch: "from-cyan-400/35 to-indigo-500/35" },
  { id: "fx-lens-warp", name: "Lens Warp", category: "distort", icon: Aperture, description: "Barrel-style bending", strength: "Medium", status: "soon", swatch: "from-teal-300/35 to-slate-900/40" },
];

export const EffectsTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<EffectCategory>("all");
  const [statusFilter, setStatusFilter] = useState<EffectStatusFilter>("all");
  const [strengthFilter, setStrengthFilter] = useState<EffectStrengthFilter>("all");

  const filteredEffects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return EFFECT_PRESETS.filter((effect) => {
      const matchesCategory = activeCategory === "all" || effect.category === activeCategory;
      const matchesStatus = statusFilter === "all" || effect.status === statusFilter;
      const matchesStrength = strengthFilter === "all" || effect.strength.toLowerCase() === strengthFilter;
      const matchesSearch = !query || effect.name.toLowerCase().includes(query) || effect.description.toLowerCase().includes(query) || effect.category.includes(query);
      return matchesCategory && matchesStatus && matchesStrength && matchesSearch;
    });
  }, [searchQuery, activeCategory, statusFilter, strengthFilter]);

  const readyCount = filteredEffects.filter((effect) => effect.status === "ready").length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      <div className="flex items-center gap-2.5 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-sm bg-accent/10 border border-accent/20 text-accent-soft">
          <Wand2 className="w-3.5 h-3.5" />
          <span className="text-[12px] font-semibold">Effects</span>
        </div>
        <div className="w-px h-5 bg-border/80 shrink-0" />
        <div className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          {EFFECT_CATEGORIES.map((category) => (
            <button key={category.id} onClick={() => setActiveCategory(category.id)} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeCategory === category.id ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-1 border-b border-border/50 bg-surface/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search effects..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised/70 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <div className="mt-1.5 flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5" style={{ scrollbarWidth: "none" }}>
          <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All states</FilterChip>
          <FilterChip active={statusFilter === "ready"} onClick={() => setStatusFilter("ready")}>Ready</FilterChip>
          <FilterChip active={statusFilter === "soon"} onClick={() => setStatusFilter("soon")}>Soon</FilterChip>
          <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
          <FilterChip active={strengthFilter === "all"} onClick={() => setStrengthFilter("all")}>Any strength</FilterChip>
          <FilterChip active={strengthFilter === "subtle"} onClick={() => setStrengthFilter("subtle")}>Subtle</FilterChip>
          <FilterChip active={strengthFilter === "medium"} onClick={() => setStrengthFilter("medium")}>Medium</FilterChip>
          <FilterChip active={strengthFilter === "strong"} onClick={() => setStrengthFilter("strong")}>Strong</FilterChip>
        </div>
      </div>

      <div className="grow overflow-y-auto scrollbar-thin p-2">
        <div className="mb-2 rounded-lg border border-border/40 bg-surface-raised/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-accent-soft shrink-0" />
              <p className="text-[11px] font-semibold text-text-primary truncate">{filteredEffects.length} effects</p>
            </div>
            <p className="text-[10px] text-text-muted shrink-0">{readyCount} ready</p>
          </div>
        </div>
        {filteredEffects.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-text-muted gap-1 text-xs">
            <Wand2 className="w-5 h-5" />
            <p>No matching effects found</p>
            <p className="opacity-60">Try another category or search</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredEffects.map((effect) => (
              <EffectCard key={effect.id} effect={effect} onAddToTimeline={() => onAddToTimeline?.(effect, "effects")} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FilterChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button type="button" onClick={onClick} className={`shrink-0 rounded-sm border px-2 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${active ? "border-accent/30 bg-accent/15 text-accent-soft" : "border-border/40 text-text-muted hover:bg-surface-raised/60 hover:text-text-primary"}`}>
    {children}
  </button>
);

const EffectCard: React.FC<{ effect: EffectPreset; onAddToTimeline: () => void }> = ({ effect, onAddToTimeline }) => {
  const Icon = effect.icon;
  const isReady = effect.status === "ready";
  return (
    <button onClick={isReady ? onAddToTimeline : undefined} disabled={!isReady} className={`group text-left rounded-lg border bg-surface-raised/60 transition-all overflow-hidden ${isReady ? "border-border/50 hover:bg-surface-raised hover:border-accent/30 cursor-pointer" : "border-border/30 opacity-70 cursor-not-allowed"}`}>
      <div className={`h-16 bg-linear-to-br ${effect.swatch} relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.42),transparent_38%)]" />
        <div className="absolute left-2 top-2 h-7 w-7 rounded-md bg-black/30 border border-white/10 flex items-center justify-center backdrop-blur-sm">
          <Icon className="w-4 h-4 text-white" />
        </div>
        <span className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${effect.status === "ready" ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/20" : "bg-white/10 text-white/70 border border-white/10"}`}>{effect.status === "ready" ? "Ready" : "Soon"}</span>
      </div>
      <div className="p-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{effect.name}</p>
          <Plus className={`w-3.5 h-3.5 text-text-muted shrink-0 transition-colors ${isReady ? "group-hover:text-accent" : ""}`} />
        </div>
        <p className="mt-1 text-[11px] leading-snug text-text-muted line-clamp-2">{effect.description}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] capitalize text-text-muted">{effect.category}</span>
          <span className="text-[10px] text-text-muted">{effect.strength}</span>
        </div>
      </div>
    </button>
  );
};
