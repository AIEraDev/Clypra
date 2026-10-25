import React, { useState } from "react";
import { Volume2, Play, Pause, Sparkles, Check } from "lucide-react";
import type { TextClip } from "@/types";

interface TextToSpeechSectionProps {
  textClip: TextClip;
}

interface VoicePreset {
  id: string;
  name: string;
  category: "Trending" | "Narrator" | "Male" | "Female" | "Character";
  language: string;
  avatarBg: string;
}

const VOICES: VoicePreset[] = [
  { id: "jessie", name: "Jessie", category: "Trending", language: "English (US)", avatarBg: "from-pink-500 to-rose-500" },
  { id: "narrator", name: "Deep Narrator", category: "Narrator", language: "English (US)", avatarBg: "from-blue-600 to-indigo-600" },
  { id: "storyteller", name: "Storyteller", category: "Narrator", language: "English (UK)", avatarBg: "from-amber-500 to-orange-600" },
  { id: "marcus", name: "Marcus", category: "Male", language: "English (US)", avatarBg: "from-emerald-500 to-teal-600" },
  { id: "clara", name: "Clara", category: "Female", language: "English (UK)", avatarBg: "from-purple-500 to-indigo-500" },
  { id: "energetic", name: "Energetic Guy", category: "Trending", language: "English (US)", avatarBg: "from-cyan-500 to-blue-500" },
  { id: "chill", name: "Chill Female", category: "Female", language: "English (US)", avatarBg: "from-violet-500 to-fuchsia-500" },
  { id: "anime", name: "Kawaii Voice", category: "Character", language: "English / Japanese", avatarBg: "from-red-400 to-pink-500" },
];

export const TextToSpeechSection: React.FC<TextToSpeechSectionProps> = ({
  textClip,
}) => {
  const [selectedVoice, setSelectedVoice] = useState<string>("jessie");
  const [category, setCategory] = useState<string>("All");
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitch, setPitch] = useState<number>(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const categories = ["All", "Trending", "Narrator", "Male", "Female", "Character"];

  const filteredVoices = VOICES.filter(
    (v) => category === "All" || v.category === category,
  );

  const handlePlayPreview = (voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingVoiceId === voiceId) {
      setPlayingVoiceId(null);
    } else {
      setPlayingVoiceId(voiceId);
      setTimeout(() => setPlayingVoiceId(null), 2500);
    }
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setGenerated(true);
      setTimeout(() => setGenerated(false), 3000);
    }, 1500);
  };

  return (
    <div className="space-y-4 p-1 select-none">
      {/* Text summary box */}
      <div className="p-3 bg-[#18181b] border border-[#2a2a2e] rounded-lg">
        <span className="text-[10px] font-semibold text-[#8e8e93] uppercase tracking-wider block mb-1">
          Source Text ({textClip.text?.length || 0} characters)
        </span>
        <p className="text-xs text-white line-clamp-2 italic">
          &quot;{textClip.text || "No text content"}&quot;
        </p>
      </div>

      {/* Category Pills */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              category === cat
                ? "bg-[#38383e] text-white shadow-sm font-semibold"
                : "bg-[#242428] text-[#8e8e93] hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Voices Grid */}
      <div className="grid grid-cols-2 gap-2">
        {filteredVoices.map((voice) => {
          const isSelected = selectedVoice === voice.id;
          const isPlaying = playingVoiceId === voice.id;
          return (
            <div
              key={voice.id}
              onClick={() => setSelectedVoice(voice.id)}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                isSelected
                  ? "bg-[#27272a] border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                  : "bg-[#202024] border-white/5 hover:border-white/15"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full bg-gradient-to-br ${voice.avatarBg} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}
                >
                  {voice.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate flex items-center gap-1">
                    {voice.name}
                    {isSelected && <Check className="w-3 h-3 text-cyan-400" />}
                  </div>
                  <div className="text-[10px] text-[#8e8e93] truncate">
                    {voice.language}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => handlePlayPreview(voice.id, e)}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 ml-1 ${
                  isPlaying
                    ? "bg-cyan-400 text-black"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
                title="Preview Voice Sample"
              >
                {isPlaying ? (
                  <Pause className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Speed & Pitch Controls */}
      <div className="space-y-3 pt-2 border-t border-border/30">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#a1a1aa]">Speech Speed</span>
          <span className="text-white font-medium">{speed.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2.0}
          step={0.1}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />

        <div className="flex items-center justify-between text-xs">
          <span className="text-[#a1a1aa]">Pitch</span>
          <span className="text-white font-medium">{pitch > 0 ? `+${pitch}` : pitch}</span>
        </div>
        <input
          type="range"
          min={-10}
          max={10}
          step={1}
          value={pitch}
          onChange={(e) => setPitch(Number(e.target.value))}
          className="w-full h-1 bg-[#3f3f46] rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
      </div>

      {/* Generate Voiceover Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full py-2 px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          {isGenerating ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Synthesizing Speech...
            </>
          ) : generated ? (
            <>
              <Check className="w-4 h-4 text-black" />
              Speech Generated &bull; Added to Audio Track
            </>
          ) : (
            <>
              <Volume2 className="w-3.5 h-3.5 fill-black" />
              Generate Speech Audio
            </>
          )}
        </button>
      </div>
    </div>
  );
};
