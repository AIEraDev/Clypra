import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import type { TabProps } from "./types";

export const StickersTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const stickers = [
    { id: "sticker-1", name: t("media.stickers.items.thumbsUp"), category: "reactions", emoji: "👍" },
    { id: "sticker-2", name: t("media.stickers.items.fire"), category: "reactions", emoji: "🔥" },
    { id: "sticker-3", name: t("media.stickers.items.heart"), category: "reactions", emoji: "❤️" },
    { id: "sticker-4", name: t("media.stickers.items.star"), category: "shapes", emoji: "⭐" },
    { id: "sticker-5", name: t("media.stickers.items.lightning"), category: "effects", emoji: "⚡" },
    { id: "sticker-6", name: t("media.stickers.items.sparkles"), category: "effects", emoji: "✨" },
    { id: "sticker-7", name: t("media.stickers.items.party"), category: "reactions", emoji: "🎉" },
    { id: "sticker-8", name: t("media.stickers.items.rocket"), category: "objects", emoji: "🚀" },
    { id: "sticker-9", name: t("media.stickers.items.trophy"), category: "objects", emoji: "🏆" },
    { id: "sticker-10", name: t("media.stickers.items.crown"), category: "objects", emoji: "👑" },
    { id: "sticker-11", name: t("media.stickers.items.clap"), category: "reactions", emoji: "👏" },
    { id: "sticker-12", name: t("media.stickers.items.hundred"), category: "reactions", emoji: "💯" },
  ];

  const filteredStickers = stickers.filter((sticker) => sticker.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <>
      <div className="p-1 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder={t("media.stickers.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
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
