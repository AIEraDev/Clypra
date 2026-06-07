import React, { useMemo, useState } from "react";
import { Filter, Grid3X3, Plus, Search, SlidersHorizontal, Sparkles, Sun, Palette, Droplets, Camera, type LucideIcon } from "lucide-react";
import type { TabProps } from "./types";

const FILTER_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "vintage", label: "Vintage" },
  { id: "modern", label: "Modern" },
  { id: "cinematic", label: "Cinematic" },
  { id: "bw", label: "B&W" },
  { id: "color", label: "Color" },
] as const;

type FilterCategory = (typeof FILTER_CATEGORIES)[number]["id"];
type FilterStatusFilter = "all" | "ready" | "soon";
type FilterIntensityFilter = "all" | "light" | "medium" | "bold";

interface FilterPreset {
  id: string;
  name: string;
  category: Exclude<FilterCategory, "all">;
  icon: LucideIcon;
  description: string;
  intensity: "Light" | "Medium" | "Bold";
  status: "ready" | "soon";
  swatch: string;
}

const FILTER_PRESETS: FilterPreset[] = [
  { id: "filter-sepia", name: "Sepia Tone", category: "vintage", icon: Sun, description: "Warm nostalgic amber", intensity: "Medium", status: "soon", swatch: "from-amber-700/60 to-orange-300/40" },
  { id: "filter-retro", name: "Retro Film", category: "vintage", icon: Camera, description: "Faded 70s color", intensity: "Medium", status: "soon", swatch: "from-orange-500/50 via-yellow-600/35 to-red-400/40" },
  { id: "filter-aged", name: "Aged Photo", category: "vintage", icon: Grid3X3, description: "Dusty faded yellow", intensity: "Light", status: "soon", swatch: "from-yellow-800/45 to-stone-400/30" },

  { id: "filter-crisp", name: "Crisp", category: "modern", icon: Sparkles, description: "Sharp clean whites", intensity: "Light", status: "soon", swatch: "from-sky-100/40 to-white/35" },
  { id: "filter-vivid", name: "Vivid", category: "modern", icon: Palette, description: "Saturated punch", intensity: "Bold", status: "soon", swatch: "from-fuchsia-500/55 via-cyan-400/45 to-lime-400/45" },
  { id: "filter-cool", name: "Cool Tone", category: "modern", icon: Droplets, description: "Blue-shifted mood", intensity: "Medium", status: "soon", swatch: "from-blue-500/50 to-cyan-300/35" },

  { id: "filter-cinematic-teal", name: "Teal & Orange", category: "cinematic", icon: SlidersHorizontal, description: "Hollywood color grade", intensity: "Bold", status: "soon", swatch: "from-teal-500/55 via-slate-700/30 to-orange-500/55" },
  { id: "filter-bleach", name: "Bleach Bypass", category: "cinematic", icon: Sun, description: "Desaturated grit", intensity: "Medium", status: "soon", swatch: "from-zinc-400/50 to-stone-600/50" },
  { id: "filter-moody", name: "Moody Blue", category: "cinematic", icon: Camera, description: "Dark blue shadows", intensity: "Bold", status: "soon", swatch: "from-indigo-900/60 to-slate-800/55" },

  { id: "filter-bw-classic", name: "Classic B&W", category: "bw", icon: Grid3X3, description: "True monochrome", intensity: "Medium", status: "soon", swatch: "from-zinc-200/50 via-zinc-500/40 to-zinc-900/60" },
  { id: "filter-high-contrast", name: "High Contrast", category: "bw", icon: SlidersHorizontal, description: "Bold tonal range", intensity: "Bold", status: "soon", swatch: "from-white/60 via-zinc-600/50 to-black/70" },
  { id: "filter-soft-bw", name: "Soft B&W", category: "bw", icon: Droplets, description: "Gentle gray tones", intensity: "Light", status: "soon", swatch: "from-stone-300/45 to-slate-600/40" },

  { id: "filter-warm", name: "Warm", category: "color", icon: Sun, description: "Golden hour glow", intensity: "Medium", status: "soon", swatch: "from-orange-400/50 to-yellow-300/40" },
  { id: "filter-cool-blue", name: "Cool Blue", category: "color", icon: Droplets, description: "Icy blue wash", intensity: "Medium", status: "soon", swatch: "from-blue-400/50 to-cyan-300/40" },
  { id: "filter-purple-haze", name: "Purple Haze", category: "color", icon: Sparkles, description: "Dreamy violet tint", intensity: "Bold", status: "soon", swatch: "from-purple-500/55 to-pink-400/45" },
];

export const FiltersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatusFilter>("all");
  const [intensityFilter, setIntensityFilter] = useState<FilterIntensityFilter>("all");

  const filteredFilters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return FILTER_PRESETS.filter((filter) => {
      const matchesCategory = activeCategory === "all" || filter.category === activeCategory;
      const matchesStatus = statusFilter === "all" || filter.status === statusFilter;
      const matchesIntensity = intensityFilter === "all" || filter.intensity.toLowerCase() === intensityFilter;
      const matchesSearch = !query || filter.name.toLowerCase().includes(query) || filter.description.toLowerCase().includes(query) || filter.category.includes(query);
      return matchesCategory && matchesStatus && matchesIntensity && matchesSearch;
    });
  }, [searchQuery, activeCategory, statusFilter, intensityFilter]);

  const readyCount = filteredFilters.filter((filter) => filter.status === "ready").length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      <div className="flex items-center gap-2.5 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-sm bg-accent/10 border border-accent/20 text-accent-soft">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[12px] font-semibold">Filters</span>
        </div>
        <div className="w-px h-5 bg-border/80 shrink-0" />
        <div className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          {FILTER_CATEGORIES.map((category) => (
            <button key={category.id} onClick={() => setActiveCategory(category.id)} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeCategory === category.id ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-1 border-b border-border/50 bg-surface/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search filters..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised/70 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
        <div className="mt-1.5 flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-0.5" style={{ scrollbarWidth: "none" }}>
          <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
            All states
          </FilterChip>
          <FilterChip active={statusFilter === "ready"} onClick={() => setStatusFilter("ready")}>
            Ready
          </FilterChip>
          <FilterChip active={statusFilter === "soon"} onClick={() => setStatusFilter("soon")}>
            Soon
          </FilterChip>
          <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
          <FilterChip active={intensityFilter === "all"} onClick={() => setIntensityFilter("all")}>
            Any intensity
          </FilterChip>
          <FilterChip active={intensityFilter === "light"} onClick={() => setIntensityFilter("light")}>
            Light
          </FilterChip>
          <FilterChip active={intensityFilter === "medium"} onClick={() => setIntensityFilter("medium")}>
            Medium
          </FilterChip>
          <FilterChip active={intensityFilter === "bold"} onClick={() => setIntensityFilter("bold")}>
            Bold
          </FilterChip>
        </div>
      </div>

      <div className="grow overflow-y-auto scrollbar-thin p-2">
        <div className="mb-2 rounded-lg border border-border/40 bg-surface-raised/35 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-accent-soft shrink-0" />
              <p className="text-[11px] font-semibold text-text-primary truncate">{filteredFilters.length} filters</p>
            </div>
            <p className="text-[10px] text-text-muted shrink-0">{readyCount} ready</p>
          </div>
        </div>
        {filteredFilters.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-text-muted gap-1 text-xs">
            <Filter className="w-5 h-5" />
            <p>No matching filters found</p>
            <p className="opacity-60">Try another category or search</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredFilters.map((filter) => (
              <FilterCard key={filter.id} filter={filter} onAddToTimeline={() => onAddToTimeline?.(filter, "filters")} />
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

const FilterCard: React.FC<{ filter: FilterPreset; onAddToTimeline: () => void }> = ({ filter, onAddToTimeline }) => {
  const Icon = filter.icon;
  const isReady = filter.status === "ready";
  return (
    <button onClick={isReady ? onAddToTimeline : undefined} disabled={!isReady} className={`group text-left rounded-lg border bg-surface-raised/60 transition-all overflow-hidden ${isReady ? "border-border/50 hover:bg-surface-raised hover:border-accent/30 cursor-pointer" : "border-border/30 opacity-70 cursor-not-allowed"}`}>
      <div className={`h-16 bg-linear-to-br ${filter.swatch} relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.42),transparent_38%)]" />
        <div className="absolute left-2 top-2 h-7 w-7 rounded-md bg-black/30 border border-white/10 flex items-center justify-center backdrop-blur-sm">
          <Icon className="w-4 h-4 text-white" />
        </div>
        <span className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${filter.status === "ready" ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/20" : "bg-white/10 text-white/70 border border-white/10"}`}>{filter.status === "ready" ? "Ready" : "Soon"}</span>
      </div>
      <div className="p-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{filter.name}</p>
          <Plus className={`w-3.5 h-3.5 text-text-muted shrink-0 transition-colors ${isReady ? "group-hover:text-accent" : ""}`} />
        </div>
        <p className="mt-1 text-[11px] leading-snug text-text-muted line-clamp-2">{filter.description}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] capitalize text-text-muted">{filter.category}</span>
          <span className="text-[10px] text-text-muted">{filter.intensity}</span>
        </div>
      </div>
    </button>
  );
};
