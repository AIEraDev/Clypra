import React, { useMemo, useState } from "react";
import { BadgeCheck, Loader2, Play, Plus, RefreshCw, Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getInsertIndexForNewTrack, useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { formatTime } from "@/lib/utils/timeFormatting";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/sequence/sequenceAutoAspect";
import { analyzeViralCuts, createViralCutClip, findUsableVideoTrack, mediaAssetToViralCutAsset, useViralCutsStore } from "@/features/viral-cuts";
import type { MediaAsset } from "@/types";

const scoreLabel = (score: number) => `${Math.round(score * 100)}%`;

export const ViralCutsTab: React.FC = () => {
  const { mediaAssets, project, updateProject, showToast } = useProjectStore();
  const { tracks, clips, addClip, insertTrackAt, getTimelineEndTime } = useTimelineStore();
  const { setPreviewMedia, previewAsset, markSourceIn, markSourceOut } = useUIStore();
  const { status, suggestions, error, dismissedIds, insertedIds, setAnalyzing, setResults, setError, dismissSuggestion, markInserted } = useViralCutsStore();
  const [targetDuration, setTargetDuration] = useState(24);

  const videoAssets = useMemo(() => mediaAssets.filter((asset) => asset.type === "video" && asset.duration > 0), [mediaAssets]);
  const visibleSuggestions = useMemo(() => suggestions.filter((suggestion) => !dismissedIds.includes(suggestion.id)), [dismissedIds, suggestions]);

  const runAnalysis = async () => {
    if (videoAssets.length === 0) {
      showToast("No video assets to analyze", "warning");
      return;
    }

    setAnalyzing();
    try {
      const result = await analyzeViralCuts({
        assets: videoAssets.map(mediaAssetToViralCutAsset),
        targetDuration,
        maxSuggestions: 18,
      });
      setResults(result.suggestions);
      showToast(`Found ${result.suggestions.length} cut candidates`);
    } catch (analysisError) {
      console.error("[ViralCutsTab] Analysis failed:", analysisError);
      setError("Analysis failed");
      showToast("Analysis failed", "error");
    }
  };

  const getAsset = (assetId: string): MediaAsset | undefined => mediaAssets.find((asset) => asset.id === assetId);

  const previewSuggestion = (suggestion: (typeof suggestions)[number]) => {
    const asset = getAsset(suggestion.assetId);
    if (!asset) return;

    setPreviewMedia(asset.id);
    previewAsset(asset);
    markSourceIn(suggestion.start);
    markSourceOut(suggestion.end);
    getActiveSessionOrNull()?.transportAuthority?.setActiveContext("source");
  };

  const insertSuggestion = (suggestion: (typeof suggestions)[number], startTime?: number) => {
    const asset = getAsset(suggestion.assetId);
    if (!asset || !project) return;

    const latestTracks = useTimelineStore.getState().tracks;
    let trackId = findUsableVideoTrack(latestTracks);
    if (!trackId) {
      trackId = insertTrackAt("video", getInsertIndexForNewTrack(latestTracks, "video"));
    }
    if (!trackId) return;

    if (clips.length === 0) {
      autoAdaptSequenceForFirstVisualClip({
        project,
        existingClips: clips,
        asset,
        updateProject,
      });
    }

    const nextProject = useProjectStore.getState().project ?? project;
    const clip = createViralCutClip({
      suggestion,
      asset,
      trackId,
      startTime: startTime ?? getTimelineEndTime(),
      project: {
        canvasWidth: nextProject.canvasWidth,
        canvasHeight: nextProject.canvasHeight,
      },
    });

    addClip(clip);
    markInserted(suggestion.id);
    showToast("Cut inserted");
  };

  const insertTopCuts = () => {
    if (!project) return;
    let nextStart = getTimelineEndTime();
    visibleSuggestions.slice(0, 3).forEach((suggestion) => {
      insertSuggestion(suggestion, nextStart);
      nextStart += suggestion.duration;
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="p-2 border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={runAnalysis} disabled={status === "analyzing" || videoAssets.length === 0}>
            {status === "analyzing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
            Find Cuts
          </Button>
          <Button variant="ghost" size="icon-sm" title="Refresh" onClick={runAnalysis} disabled={status === "analyzing" || videoAssets.length === 0}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="shrink-0">Length</span>
          <input
            type="range"
            min={12}
            max={45}
            step={3}
            value={targetDuration}
            onChange={(event) => setTargetDuration(Number(event.target.value))}
            className="min-w-0 flex-1 accent-accent"
            aria-label="Target cut length"
          />
          <span className="w-8 text-right tabular-nums">{targetDuration}s</span>
        </div>

        {visibleSuggestions.length > 0 && (
          <Button variant="default" size="sm" className="w-full" onClick={insertTopCuts}>
            <Plus className="w-4 h-4" />
            Insert Top 3
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {videoAssets.length === 0 ? (
          <EmptyState icon={Scissors} title="No video media" />
        ) : status === "error" ? (
          <EmptyState icon={Scissors} title={error ?? "Analysis failed"} />
        ) : visibleSuggestions.length === 0 ? (
          <EmptyState icon={Scissors} title={status === "analyzing" ? "Analyzing" : "No cuts yet"} />
        ) : (
          <div className="p-2 space-y-2">
            {visibleSuggestions.map((suggestion) => {
              const inserted = insertedIds.includes(suggestion.id);
              return (
                <div key={suggestion.id} className="rounded-md border border-border bg-surface-raised overflow-hidden">
                  <div className="p-2 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-text-primary truncate">{suggestion.title}</span>
                          {inserted && <BadgeCheck className="w-3.5 h-3.5 text-accent shrink-0" />}
                        </div>
                        <p className="text-[10px] text-text-muted truncate">{suggestion.assetName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[12px] font-semibold text-accent tabular-nums">{scoreLabel(suggestion.score)}</div>
                        <div className="text-[9px] uppercase text-text-muted">{suggestion.confidence}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
                      <span className="font-mono tabular-nums">
                        {formatTime(suggestion.start)} - {formatTime(suggestion.end)}
                      </span>
                      <span className="font-mono tabular-nums">{formatTime(suggestion.duration)}</span>
                    </div>

                    {suggestion.reasons.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {suggestion.reasons.map((reason) => (
                          <span key={reason} className="px-1.5 py-0.5 rounded bg-bg text-[9px] text-text-muted">
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      <Button variant="secondary" size="xs" className="flex-1" onClick={() => previewSuggestion(suggestion)}>
                        <Play className="w-3 h-3" />
                        Preview
                      </Button>
                      <Button variant="default" size="xs" className="flex-1" onClick={() => insertSuggestion(suggestion)} disabled={inserted}>
                        <Plus className="w-3 h-3" />
                        {inserted ? "Inserted" : "Insert"}
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="Dismiss" onClick={() => dismissSuggestion(suggestion.id)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
