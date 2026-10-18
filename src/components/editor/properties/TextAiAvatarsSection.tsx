import React, { useState } from "react";
import { Sparkles, User, Check, Layers, Video } from "lucide-react";
import type { TextClip } from "@/types";

interface TextAiAvatarsSectionProps {
  textClip: TextClip;
}

interface AvatarPresenter {
  id: string;
  name: string;
  role: string;
  gender: "Female" | "Male";
  tag: string;
  bgColor: string;
}

const AVATARS: AvatarPresenter[] = [
  { id: "elena", name: "Elena", role: "Studio Host", gender: "Female", tag: "Professional", bgColor: "from-purple-600 to-indigo-800" },
  { id: "marcus", name: "Marcus", role: "Tech Reviewer", gender: "Male", tag: "Tech / Modern", bgColor: "from-blue-600 to-cyan-800" },
  { id: "sophie", name: "Sophie", role: "Casual Creator", gender: "Female", tag: "Lifestyle", bgColor: "from-rose-500 to-pink-700" },
  { id: "david", name: "David", role: "Business Executive", gender: "Male", tag: "Corporate", bgColor: "from-amber-600 to-orange-800" },
  { id: "clara", name: "Clara", role: "News Anchor", gender: "Female", tag: "Formal", bgColor: "from-teal-600 to-emerald-800" },
  { id: "liam", name: "Liam", role: "Friendly Guide", gender: "Male", tag: "Casual", bgColor: "from-violet-600 to-purple-800" },
];

export const TextAiAvatarsSection: React.FC<TextAiAvatarsSectionProps> = ({
  textClip,
}) => {
  const [selectedAvatar, setSelectedAvatar] = useState<string>("elena");
  const [framing, setFraming] = useState<"half" | "full" | "circle">("half");
  const [background, setBackground] = useState<"transparent" | "greenscreen">("transparent");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setGenerated(true);
      setTimeout(() => setGenerated(false), 3000);
    }, 1800);
  };

  return (
    <div className="space-y-4 p-1 select-none">
      {/* Pro Banner */}
      <div className="p-3 bg-gradient-to-r from-purple-900/40 via-indigo-900/30 to-purple-900/40 border border-purple-500/30 rounded-xl relative overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-purple-400 text-sm">◆</span>
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            AI Digital Presenter
          </span>
          <span className="ml-auto text-[9px] font-bold bg-purple-500 text-white px-2 py-0.5 rounded-full">
            AI STUDIO
          </span>
        </div>
        <p className="text-[11px] text-purple-200/80 mt-1 leading-relaxed">
          Create a lifelike AI human that speaks &quot;{textClip.text || "your text"}&quot; with realistic lip-sync and expressions.
        </p>
      </div>

      {/* Avatar Presets Grid */}
      <div>
        <span className="text-xs font-medium text-[#a1a1aa] block mb-2">
          Choose Presenter
        </span>
        <div className="grid grid-cols-2 gap-2">
          {AVATARS.map((avatar) => {
            const isSelected = selectedAvatar === avatar.id;
            return (
              <div
                key={avatar.id}
                onClick={() => setSelectedAvatar(avatar.id)}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col items-center text-center relative ${
                  isSelected
                    ? "bg-[#27272a] border-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.2)]"
                    : "bg-[#202024] border-white/5 hover:border-white/15"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
                <div
                  className={`w-12 h-12 rounded-full bg-gradient-to-tr ${avatar.bgColor} flex items-center justify-center text-white mb-2 shadow-md`}
                >
                  <User className="w-6 h-6 opacity-90" />
                </div>
                <div className="text-xs font-bold text-white truncate max-w-full">
                  {avatar.name}
                </div>
                <div className="text-[10px] text-purple-300 truncate max-w-full">
                  {avatar.role}
                </div>
                <span className="text-[9px] text-[#8e8e93] bg-white/5 px-1.5 py-0.5 rounded mt-1">
                  {avatar.tag}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Framing & Placement */}
      <div className="space-y-3 pt-2 border-t border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#a1a1aa]">Framing</span>
          <div className="flex bg-[#242428] border border-white/5 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setFraming("half")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                framing === "half"
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Half Body
            </button>
            <button
              type="button"
              onClick={() => setFraming("full")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                framing === "full"
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Full Body
            </button>
            <button
              type="button"
              onClick={() => setFraming("circle")}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                framing === "circle"
                  ? "bg-[#38383e] text-white shadow-sm font-semibold"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Circle
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[#a1a1aa]">Background</span>
          <div className="flex bg-[#242428] border border-white/5 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setBackground("transparent")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                background === "transparent"
                  ? "bg-[#38383e] text-white shadow-sm"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Transparent
            </button>
            <button
              type="button"
              onClick={() => setBackground("greenscreen")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                background === "greenscreen"
                  ? "bg-[#38383e] text-white shadow-sm"
                  : "text-[#8e8e93] hover:text-white"
              }`}
            >
              Green Screen
            </button>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 disabled:opacity-60 text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-purple-500/25"
        >
          {isGenerating ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Rendering Digital Presenter...
            </>
          ) : generated ? (
            <>
              <Check className="w-4 h-4" />
              Presenter Generated &bull; Added as Overlay
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 fill-current" />
              Generate AI Avatar Video
            </>
          )}
        </button>
      </div>
    </div>
  );
};
