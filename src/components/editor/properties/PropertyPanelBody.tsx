import { VolumeX } from "lucide-react";
import type { Clip, TextClip } from "@/types";
import type { TextPropertyTab, VideoPropertyTab } from "./types";
import type { TextPreset } from "@/store/presetStore";
import { TextStyleSection } from "./TextStyleSection";
import { TransformSection } from "./TransformSection";
import { MotionPresetSection } from "./MotionPresetSection";
import { TextTrackingSection } from "./TextTrackingSection";
import { TextToSpeechSection } from "./TextToSpeechSection";
import { TextAiAvatarsSection } from "./TextAiAvatarsSection";
import { AudioSection } from "./AudioSection";
import { EffectsFiltersSection } from "./EffectsFiltersSection";
import { StickerSettingsSection } from "./StickerSettingsSection";
import { TimelineEffectSection } from "./TimelineEffectSection";
import { AdjustmentsSection } from "./AdjustmentsSection";
import { PlaybackSection } from "./PlaybackSection";
import { ChromaKeySection } from "./ChromaKeySection";
import type { Command } from "@/core/history/Command";
import { RelinkAudioCommand } from "@/core/history/commands/UnlinkAudioCommand";

interface PropertyPanelBodyProps {
  selectedClip: Clip;
  textClip: TextClip;
  activePropertyTab: TextPropertyTab | VideoPropertyTab | null;
  isSticker: boolean;
  isTextClip: boolean;
  isVisualClip: boolean;
  isVideoClip: boolean;
  isAudioClip: boolean;
  isTimelineEffectClip: boolean;
  hasAudioTrack: boolean;
  supportsAnimation: boolean;
  canvasWidth: number;
  canvasHeight: number;
  linkedAudio: Clip | undefined;
  sourceVideo: Clip | undefined;
  presets: TextPreset[];
  newPresetName: string;
  setNewPresetName: (name: string) => void;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleUpdateImmediate: (key: string, value: any) => void;
  handleUpdateMultipleImmediate: (fields: Record<string, any>) => void;
  handleApplyPreset: (preset: TextPreset) => void;
  handleApplyFit: (fitMode: any) => void;
  handleUnlinkAudio: () => void;
  handleRelinkAudio: () => void;
  executePreviewCommand: (command: Command) => void;
  savePreset: (
    name: string,
    presetData: Omit<TextPreset, "id" | "name" | "isCustom">,
  ) => void;
  deletePreset: (id: string) => void;
}

const PropertyPanelBody: React.FC<PropertyPanelBodyProps> = ({
  selectedClip,
  textClip,
  activePropertyTab,
  isSticker,
  isTextClip,
  isVisualClip,
  isVideoClip,
  isAudioClip,
  isTimelineEffectClip,
  hasAudioTrack,
  supportsAnimation,
  canvasWidth,
  canvasHeight,
  linkedAudio,
  sourceVideo,
  presets,
  newPresetName,
  setNewPresetName,
  handleUpdate,
  handleUpdateMultiple,
  handleUpdateImmediate,
  handleUpdateMultipleImmediate,
  handleApplyPreset,
  handleApplyFit,
  handleUnlinkAudio,
  handleRelinkAudio,
  executePreviewCommand,
  savePreset,
  deletePreset,
}) => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin flex flex-col space-y-1 relative">
      {/* Sticker properties */}
      {isSticker && (
        <StickerSettingsSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* Audio properties (audio clips or video clips) */}
      {hasAudioTrack && (
        <AudioSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
          onUnlink={isVideoClip && !linkedAudio ? handleUnlinkAudio : undefined}
          onRelink={
            sourceVideo
              ? handleRelinkAudio
              : linkedAudio
                ? () =>
                    executePreviewCommand(
                      new RelinkAudioCommand(selectedClip, linkedAudio),
                    )
                : undefined
          }
        />
      )}

      {/* No audio stream banner for silent video clips */}
      {isVideoClip && !hasAudioTrack && (
        <div className="rounded-lg border border-border/40 bg-surface-raised/40 p-3 text-xs text-text-muted flex items-start gap-2.5">
          <VolumeX className="w-4 h-4 text-text-muted/70 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-text-secondary">No Audio Stream</p>
            <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
              This video contains no embedded audio. You can add music or
              voiceover from the sidebar.
            </p>
          </div>
        </div>
      )}

      {/* Text Styling (text clip + text tab) */}
      {isTextClip && activePropertyTab === "text" && (
        <TextStyleSection
          textClip={textClip}
          presets={presets}
          newPresetName={newPresetName}
          setNewPresetName={setNewPresetName}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleUpdateImmediate={handleUpdateImmediate}
          handleUpdateMultipleImmediate={handleUpdateMultipleImmediate}
          handleApplyPreset={handleApplyPreset}
          savePreset={savePreset}
          deletePreset={deletePreset}
        />
      )}

      {/* Text Animations (text clip + animation tab) */}
      {isTextClip && activePropertyTab === "animation" && (
        <MotionPresetSection
          selectedClip={selectedClip}
          handleUpdateMultiple={handleUpdateMultiple}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      )}

      {/* Text Tracking */}
      {isTextClip && activePropertyTab === "tracking" && (
        <TextTrackingSection textClip={textClip} />
      )}

      {/* Text To Speech */}
      {isTextClip && activePropertyTab === "tts" && (
        <TextToSpeechSection textClip={textClip} />
      )}

      {/* AI Avatars */}
      {isTextClip && activePropertyTab === "ai_avatars" && (
        <TextAiAvatarsSection textClip={textClip} />
      )}

      {/* Transform (visual non-text clips) */}
      {supportsAnimation && !isTextClip && (
        <TransformSection
          selectedClip={selectedClip}
          isVisualClip={isVisualClip}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={handleApplyFit}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      )}

      {/* Motion & Animation Presets (Build-In, Build-Out, Loop) for visual non-text clips */}
      {supportsAnimation && !isTextClip && (
        <MotionPresetSection
          selectedClip={selectedClip}
          handleUpdateMultiple={handleUpdateMultiple}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      )}

      {/* Playback speed, reverse, freeze frame */}
      {(isVideoClip || isAudioClip) && (
        <PlaybackSection selectedClip={selectedClip} />
      )}

      {/* Color Adjustments */}
      {isVisualClip && (
        <AdjustmentsSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* UltraKey (Chroma Key) */}
      {isVisualClip && <ChromaKeySection selectedClip={selectedClip} />}

      {/* Effects and Filters */}
      {isVisualClip && (
        <EffectsFiltersSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* Timeline filter/effect clips */}
      {isTimelineEffectClip && (
        <TimelineEffectSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}
    </div>
  );
};

export default PropertyPanelBody;
