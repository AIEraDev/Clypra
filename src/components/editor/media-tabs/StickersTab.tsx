import React, { useState } from "react";
import { Search } from "lucide-react";
import type { TabProps } from "./types";

export const StickersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");

  const stickers = [
    { id: "sticker-1", name: "Thumbs Up", category: "reactions", emoji: "👍" },
    { id: "sticker-2", name: "Fire", category: "reactions", emoji: "🔥" },
    { id: "sticker-3", name: "Heart", category: "reactions", emoji: "❤️" },
    { id: "sticker-4", name: "Star", category: "shapes", emoji: "⭐" },
    { id: "sticker-5", name: "Lightning", category: "effects", emoji: "⚡" },
    { id: "sticker-6", name: "Sparkles", category: "effects", emoji: "✨" },
    { id: "sticker-7", name: "Party", category: "reactions", emoji: "🎉" },
    { id: "sticker-8", name: "Rocket", category: "objects", emoji: "🚀" },
    { id: "sticker-9", name: "Trophy", category: "objects", emoji: "🏆" },
    { id: "sticker-10", name: "Crown", category: "objects", emoji: "👑" },
    { id: "sticker-11", name: "Clap", category: "reactions", emoji: "👏" },
    { id: "sticker-12", name: "100", category: "reactions", emoji: "💯" },
  ];

  const filteredStickers = stickers.filter((sticker) => sticker.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <>
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search stickers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        <div className="grid grid-cols-4 gap-2">
          {filteredStickers.map((sticker) => (
            <StickerCard key={sticker.id} sticker={sticker} onAddToTimeline={() => onAddToTimeline?.(sticker, "stickers")} />
          ))}
        </div>
      </div>
    </>
  );
};

// StickerCard Component
const StickerCard: React.FC<{ sticker: any; onAddToTimeline: () => void }> = ({ sticker, onAddToTimeline }) => {
  return (
    <button onClick={onAddToTimeline} className="aspect-square bg-surface-raised hover:bg-surface-raised/80 rounded-lg flex items-center justify-center text-4xl transition-colors hover:scale-110 transition-transform" title={sticker.name}>
      {sticker.emoji}
    </button>
  );
};
