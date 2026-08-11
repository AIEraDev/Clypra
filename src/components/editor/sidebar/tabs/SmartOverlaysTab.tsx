import React, { useState } from "react";
import { Sparkles, Plus, Wand2, Sliders, TrendingUp, Quote, Columns, Code, List, Clock, Share2, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTimelineStore, getInsertIndexForNewTrack } from "@/store/timelineStore";
import { SMART_OVERLAY_PRESETS, getSmartOverlayPreset, type SmartOverlayType, type SmartOverlayClip, type ComparisonOverlayContent } from "@/types/smartOverlay";

import { extractSmartOverlaysFromTranscript } from "@/features/smart-overlays/services/smartOverlayExtractor";
import type { TabProps } from "../types";

export const SmartOverlaysTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const { clips, tracks, addClip, updateClip, addTrack } = useTimelineStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<SmartOverlayType | "all">("all");
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  // Active smart overlay clip for property editing
  const selectedClip = clips.find((c) => c.kind === "smart-overlay" && (selectedClipId ? c.id === selectedClipId : true)) as
    | SmartOverlayClip
    | undefined;

  const categories: { id: SmartOverlayType | "all"; label: string; icon: any }[] = [
    { id: "all", label: "All", icon: Sparkles },
    { id: "stat", label: "Stats", icon: TrendingUp },
    { id: "quote", label: "Quotes", icon: Quote },
    { id: "comparison", label: "Compare", icon: Columns },
    { id: "code", label: "Code", icon: Code },
    { id: "list", label: "Lists", icon: List },
    { id: "timeline", label: "Timeline", icon: Clock },
    { id: "social", label: "Social", icon: Share2 },
    { id: "lower-third", label: "Lower 3rd", icon: User },
  ];

  const filteredPresets =
    selectedCategory === "all"
      ? SMART_OVERLAY_PRESETS
      : SMART_OVERLAY_PRESETS.filter((p) => p.category === selectedCategory);

  const ensureTrack = (trackId: string, name: string): string => {
    const existing = tracks.find((t) => t.id === trackId);
    if (existing) return existing.id;

    const timeline = useTimelineStore.getState();
    const insertIndex = getInsertIndexForNewTrack(timeline.tracks, "animated-overlay");
    const targetTrackId = timeline.insertTrackAt("animated-overlay", insertIndex);
    return targetTrackId;
  };

  const handleAddPreset = (presetId: string) => {
    const preset = getSmartOverlayPreset(presetId);
    const trackId = ensureTrack("animated-overlay", "Smart Overlays");

    const newClip: SmartOverlayClip = {
      id: `smart-overlay-${Date.now()}`,
      kind: "smart-overlay",
      overlayType: preset.category,
      trackId,
      mediaId: "",
      startTime: 1.0,
      duration: 5.0,
      trimIn: 0,
      trimOut: 5.0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      content: JSON.parse(JSON.stringify(preset.defaultContent)),
      style: { ...preset.style },
    };

    addClip(newClip);
    setSelectedClipId(newClip.id);
    if (onAddToTimeline) {
      onAddToTimeline(newClip, "smart-overlays");
    }
  };


  const handleAutoDetectAI = async () => {
    setIsGenerating(true);
    try {
      // Sample multi-topic speech transcript with stats, quotes, and comparisons
      const mockTranscript = {
        segments: [
          { text: "Our user base grew by 142% to 2.5M users.", start: 1.0, end: 4.5 },
          { text: "As Steve Jobs said, simplicity is sophistication.", start: 5.0, end: 8.5 }, // Overlaps or follows
          { text: "Let's compare React versus Vue for latency.", start: 6.0, end: 9.5 },       // Overlaps!
          { text: "Run npm install react to get started.", start: 10.0, end: 13.0 },
        ],
      };

      const plan = extractSmartOverlaysFromTranscript(mockTranscript, tracks);

      // Create any required secondary tracks for overlapping clips
      plan.requiredTracks.forEach((reqTrack) => {
        ensureTrack(reqTrack.id, reqTrack.name);
      });

      // Add all AI-extracted clips
      plan.clips.forEach((clip) => {
        addClip(clip);
      });

      if (plan.clips.length > 0) {
        setSelectedClipId(plan.clips[0].id);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-text-primary p-4 gap-4 overflow-y-auto">
      {/* Header Banner */}
      <div className="flex flex-col gap-2 p-3.5 rounded-lg bg-gradient-to-r from-indigo-950/40 via-purple-900/30 to-violet-950/40 border border-indigo-500/20">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <h3 className="font-semibold text-sm text-indigo-200">Universal Smart Overlays</h3>
        </div>
        <p className="text-xs text-text-muted">
          AI speech-intent graphic overlays: stats, quotes, comparisons, code, timelines & lists.
        </p>
      </div>

      {/* AI Auto Detect Section */}
      <div className="flex flex-col gap-2 bg-white/5 p-3 rounded-lg border border-white/10">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-muted">AI Contextual Auto-Detect</span>
          <Wand2 className="w-4 h-4 text-accent" />
        </div>
        <Button
          onClick={handleAutoDetectAI}
          disabled={isGenerating}
          className="w-full bg-accent hover:bg-accent/90 text-white gap-2 font-medium"
        >
          {isGenerating ? (
            <>
              <span className="animate-spin text-xs">🌀</span> Detecting Intents...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" /> Auto-Detect & Generate Overlays
            </>
          )}
        </Button>
      </div>

      {/* Category Pills */}
      <div className="flex overflow-x-auto gap-1.5 pb-1 scrollbar-none">
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat.id ? "bg-accent text-white" : "bg-white/5 text-text-muted hover:bg-white/10"
              }`}
            >
              <Icon className="w-3 h-3" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Preset Cards Grid */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2.5">
          {filteredPresets.map((preset) => (
            <div
              key={preset.id}
              onClick={() => handleAddPreset(preset.id)}
              className="flex flex-col p-3 rounded-lg border bg-white/5 border-white/10 hover:border-accent hover:bg-white/8 cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-text-primary">{preset.name}</span>
                <Plus className="w-3.5 h-3.5 text-text-muted hover:text-white" />
              </div>
              <p className="text-[11px] text-text-muted line-clamp-2">{preset.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Dynamic Polymorphic Property Editor */}
      {selectedClip && (
        <div className="flex flex-col gap-3 mt-2 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between text-xs font-semibold text-accent">
            <span className="flex items-center gap-1.5">
              <Sliders className="w-4 h-4" /> Customize ({selectedClip.overlayType.toUpperCase()})
            </span>
          </div>

          {/* Stat Overlay Controls */}
          {selectedClip.content.type === "stat" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted">Metric Value</label>
                <input
                  type="text"
                  value={selectedClip.content.data.value}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      content: {
                        ...selectedClip.content,
                        data: { ...selectedClip.content.data, value: e.target.value },
                      },
                    } as any)
                  }
                  className="px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted">Label Subtitle</label>
                <input
                  type="text"
                  value={selectedClip.content.data.label}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      content: {
                        ...selectedClip.content,
                        data: { ...selectedClip.content.data, label: e.target.value },
                      },
                    } as any)
                  }
                  className="px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white"
                />
              </div>
            </>
          )}

          {/* Quote Overlay Controls */}
          {selectedClip.content.type === "quote" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted">Quote Text</label>
                <textarea
                  value={selectedClip.content.data.quote}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      content: {
                        ...selectedClip.content,
                        data: { ...selectedClip.content.data, quote: e.target.value },
                      },
                    } as any)
                  }
                  className="px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white h-16 resize-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted">Author Name</label>
                <input
                  type="text"
                  value={selectedClip.content.data.author}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      content: {
                        ...selectedClip.content,
                        data: { ...selectedClip.content.data, author: e.target.value },
                      },
                    } as any)
                  }
                  className="px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white"
                />
              </div>
            </>
          )}

          {/* Comparison Overlay Controls */}
          {selectedClip.content.type === "comparison" && (() => {
            const compData = selectedClip.content.data as ComparisonOverlayContent;
            return (

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-text-muted">Option A</label>
                  <input
                    type="text"
                    value={compData.left.title}
                    onChange={(e) =>
                      updateClip(selectedClip.id, {
                        content: {
                          ...selectedClip.content,
                          data: {
                            ...compData,
                            left: { ...compData.left, title: e.target.value },
                          },
                        },
                      } as any)
                    }
                    className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-white"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-text-muted">Option B</label>
                  <input
                    type="text"
                    value={compData.right.title}
                    onChange={(e) =>
                      updateClip(selectedClip.id, {
                        content: {
                          ...selectedClip.content,
                          data: {
                            ...compData,
                            right: { ...compData.right, title: e.target.value },
                          },
                        },
                      } as any)
                    }
                    className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-white"
                  />
                </div>
              </div>
            );
          })()}


          {/* Code Overlay Controls */}
          {selectedClip.content.type === "code" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted">Language</label>
                <input
                  type="text"
                  value={selectedClip.content.data.language}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      content: {
                        ...selectedClip.content,
                        data: { ...selectedClip.content.data, language: e.target.value },
                      },
                    } as any)
                  }
                  className="px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted">Code Block</label>
                <textarea
                  value={selectedClip.content.data.code}
                  onChange={(e) =>
                    updateClip(selectedClip.id, {
                      content: {
                        ...selectedClip.content,
                        data: { ...selectedClip.content.data, code: e.target.value },
                      },
                    } as any)
                  }
                  className="px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white font-mono h-20 resize-none"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
