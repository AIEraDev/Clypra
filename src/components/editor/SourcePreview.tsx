import React, { useRef, useState, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, Plus, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button } from "../ui/Button";
import { useUIStore } from "../../store/uiStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useProjectStore } from "../../store/projectStore";
import { createClipFromAsset } from "../../lib/timelineClip";

export const SourcePreview: React.FC = () => {
  const { sourceAsset, sourceInPoint, sourceOutPoint, exitSourceMode, markSourceIn, markSourceOut } = useUIStore();
  const { tracks, clips, addClip, addTrack } = useTimelineStore();
  const { project } = useProjectStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Reset when asset changes
  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
  }, [sourceAsset?.id]);

  // Update current time during playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("ended", handleEnded);
    };
  }, []);

  if (!sourceAsset) return null;

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  };

  const handleStepFrame = (direction: "forward" | "backward") => {
    const frameTime = 1 / 30; // Assume 30fps
    const newTime = direction === "forward" ? currentTime + frameTime : currentTime - frameTime;
    handleSeek(Math.max(0, Math.min(duration, newTime)));
  };

  const handleMarkIn = () => {
    markSourceIn(currentTime);
  };

  const handleMarkOut = () => {
    markSourceOut(currentTime);
  };

  const handleAddToTimeline = () => {
    if (!project) return;

    const targetTrackType = sourceAsset.type === "audio" ? "audio" : "video";
    let targetTrack = tracks.find((track) => track.type === targetTrackType && !track.locked);

    // Create track if needed
    if (!targetTrack) {
      addTrack(targetTrackType);
      targetTrack = useTimelineStore.getState().tracks.find((t) => t.type === targetTrackType && !t.locked);
    }

    if (!targetTrack) return;

    // Find end time of clips on this track
    const trackClips = clips.filter((c) => c.trackId === targetTrack.id);
    const startTime = trackClips.length > 0 ? Math.max(...trackClips.map((c) => c.startTime + c.duration)) : 0;

    // Create base clip (this handles image duration properly)
    const newClip = createClipFromAsset({
      asset: sourceAsset,
      trackId: targetTrack.id,
      startTime,
      width: project.canvasWidth,
      height: project.canvasHeight,
    });

    // Apply trim points if set
    const trimIn = sourceInPoint ?? 0;
    const trimOut = sourceOutPoint ?? newClip.duration; // Use resolved duration, not sourceAsset.duration
    const clipDuration = trimOut - trimIn;

    newClip.trimIn = trimIn;
    newClip.trimOut = trimOut;
    newClip.duration = clipDuration;

    addClip(newClip);
    exitSourceMode();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  };

  const sourcePath = convertFileSrc(sourceAsset.path);

  return (
    <div className="flex-1 bg-transparent flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-text-primary">Source Preview</div>
          <div className="text-xs text-text-muted">{sourceAsset.name}</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={exitSourceMode} title="Return to Timeline (Esc)">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Video Preview */}
      <div className="flex-1 flex items-center justify-center p-2 overflow-hidden bg-[#0a0e14]">
        <div className="w-full h-full flex items-center justify-center">
          {sourceAsset.type === "video" ? (
            <video ref={videoRef} src={sourcePath} className="max-w-full max-h-full object-contain rounded-lg" />
          ) : sourceAsset.type === "image" ? (
            <img src={sourcePath} alt={sourceAsset.name} className="max-w-full max-h-full object-contain rounded-lg" />
          ) : (
            <div className="w-64 h-64 bg-surface-raised rounded-lg flex items-center justify-center">
              <div className="text-text-muted">Audio Preview</div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 pb-4">
        <div className="panel-shell panel-head p-3 flex flex-col gap-3">
          {/* Playback Controls */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" onClick={() => handleStepFrame("backward")} title="Previous frame">
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => handleStepFrame("forward")} title="Next frame">
              <SkipForward className="w-4 h-4" />
            </Button>

            <div className="text-xs text-text-primary min-w-[100px]">{formatTime(currentTime)}</div>

            {/* Scrub Bar */}
            <div className="flex-1 relative h-8 flex items-center">
              <div
                className="w-full h-2 rounded bg-[#222a34] border border-[#2f3846] cursor-pointer relative"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  handleSeek(ratio * duration);
                }}
              >
                {/* In/Out markers */}
                {sourceInPoint !== null && <div className="absolute top-0 bottom-0 bg-green-500/30" style={{ left: `${(sourceInPoint / duration) * 100}%`, width: "2px" }} />}
                {sourceOutPoint !== null && <div className="absolute top-0 bottom-0 bg-red-500/30" style={{ left: `${(sourceOutPoint / duration) * 100}%`, width: "2px" }} />}
                {/* Progress */}
                <div className="h-full rounded bg-[#53a9ff]" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
              </div>
            </div>

            <div className="text-xs text-text-muted min-w-[100px] text-right">{formatTime(duration)}</div>
          </div>

          {/* In/Out and Add Controls */}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleMarkIn} title="Mark In (I)">
              Mark In {sourceInPoint !== null && `(${formatTime(sourceInPoint)})`}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleMarkOut} title="Mark Out (O)">
              Mark Out {sourceOutPoint !== null && `(${formatTime(sourceOutPoint)})`}
            </Button>
            <div className="flex-1" />
            <Button variant="default" size="sm" onClick={handleAddToTimeline}>
              <Plus className="w-4 h-4" />
              Add to Timeline
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
