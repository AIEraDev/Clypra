import { VolumeX } from "lucide-react";
import type { Clip, TextClip } from "@/types";
import type {
  TextPropertyTab,
  VideoPropertyTab,
  AudioPropertyTab,
} from "../types";
import type { TextPreset } from "@/store/presetStore";
import { TextStyleSection } from "../text/sections/TextStyleSection";
import { VideoStyleSection } from "../video/sections/VideoStyleSection";
import { TransformSection } from "../shared/TransformSection";
import { MotionPresetSection } from "../shared/MotionPresetSection";
import { TextTrackingSection } from "../text/sections/TextTrackingSection";
import { TextToSpeechSection } from "../text/sections/TextToSpeechSection";
import { TextAiAvatarsSection } from "../text/sections/TextAiAvatarsSection";
import { AudioSection } from "../audio/sections/AudioSection";
import { AudioStyleSection } from "../video/sections/AudioStyleSection";
import { AudioBasicTab } from "../audio/tabs/AudioBasicTab";
import { AudioVoiceChangerTab } from "../audio/tabs/AudioVoiceChangerTab";
import { EffectsFiltersSection } from "../effects/sections/EffectsFiltersSection";
import { StickerSettingsSection } from "../image/sections/StickerSettingsSection";
import { TimelineEffectSection } from "../effects/sections/TimelineEffectSection";
import { VideoAdjustTab } from "../video/tabs/VideoAdjustTab";
import { AdjustmentsSection } from "../legacy/AdjustmentsSection";
import { PlaybackSection } from "../legacy/PlaybackSection";
import { SpeedStyleSection } from "../shared/SpeedSection";
import { ChromaKeySection } from "../effects/sections/ChromaKeySection";
import type { Command } from "@/core/history/Command";
import { RelinkAudioCommand } from "@/core/history/commands/UnlinkAudioCommand";

interface PropertyPanelBodyProps {
  selectedClip: Clip;
  textClip: TextClip;
  activePropertyTab:
    | TextPropertyTab
    | VideoPropertyTab
    | AudioPropertyTab
    | null;
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

      {/* Video Tab: Sub-tabs with Basic, Remove BG, Mask, Retouch */}
      {isVideoClip && activePropertyTab === "video" && (
        <VideoStyleSection
          selectedClip={selectedClip}
          isVisualClip={isVisualClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={handleApplyFit}
        />
      )}

      {/* Audio Tab: Audio properties with sub-tabs */}
      {isVideoClip && activePropertyTab === "audio" && (
        <>
          {hasAudioTrack ? (
            <AudioStyleSection
              selectedClip={selectedClip}
              handleUpdate={handleUpdate}
              onUnlink={!linkedAudio ? handleUnlinkAudio : undefined}
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
          ) : (
            <div className="rounded-lg border border-border/40 bg-surface-raised/40 p-3 text-xs text-text-muted flex items-start gap-2.5">
              <VolumeX className="w-4 h-4 text-text-muted/70 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-text-secondary">
                  No Audio Stream
                </p>
                <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                  This video contains no embedded audio. You can add music or
                  voiceover from the sidebar.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Speed Tab: Speed controls with sub-tabs */}
      {isVideoClip && activePropertyTab === "speed" && (
        <SpeedStyleSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* Animation Tab: Motion presets */}
      {isVideoClip && activePropertyTab === "animation" && (
        <MotionPresetSection
          selectedClip={selectedClip}
          handleUpdateMultiple={handleUpdateMultiple}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      )}

      {/* Adjust Tab: Color Adjustments */}
      {isVideoClip && activePropertyTab === "adjust" && (
        <VideoAdjustTab
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* Legacy: Audio properties (audio clips or video clips without tabs) */}
      {hasAudioTrack && !isVideoClip && (
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
      {/* {isTextClip && activePropertyTab === "tracking" && (
        <TextTrackingSection textClip={textClip} />
      )} */}

      {/* Text To Speech */}
      {/* {isTextClip && activePropertyTab === "tts" && (
        <TextToSpeechSection textClip={textClip} />
      )} */}

      {/* AI Avatars */}
      {/* {isTextClip && activePropertyTab === "ai_avatars" && (
        <TextAiAvatarsSection textClip={textClip} />
      )} */}

      {/* Legacy: Transform (visual non-text clips without tabs) */}
      {supportsAnimation && !isTextClip && !isVideoClip && (
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

      {/* Legacy: Motion & Animation Presets (In, Out, Loop) for visual non-text clips without tabs */}
      {supportsAnimation && !isTextClip && !isVideoClip && (
        <MotionPresetSection
          selectedClip={selectedClip}
          handleUpdateMultiple={handleUpdateMultiple}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      )}

      {/* Legacy: Playback speed, reverse, freeze frame (without tabs) */}
      {/* Removed - audio clips now use tabbed interface */}

      {/* Audio Clip Tabs */}
      {isAudioClip && activePropertyTab === "basic" && (
        <AudioBasicTab
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {isAudioClip && activePropertyTab === "voice-changer" && (
        <AudioVoiceChangerTab />
      )}

      {isAudioClip && activePropertyTab === "speed" && (
        <SpeedStyleSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* Legacy: Color Adjustments (without tabs) */}
      {isVisualClip && !isVideoClip && (
        <AdjustmentsSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      )}

      {/* Legacy: UltraKey (Chroma Key) (without tabs) */}
      {isVisualClip && !isVideoClip && (
        <ChromaKeySection selectedClip={selectedClip} />
      )}

      {/* Legacy: Effects and Filters (without tabs) */}
      {isVisualClip && !isVideoClip && (
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
