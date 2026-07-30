import React from "react";
import { Mic, Square } from "lucide-react";
import { useVoiceoverRecorder } from "@/hooks/useVoiceoverRecorder";

export const VoiceoverRecorderButton: React.FC = () => {
  const { voiceoverActive, startVoiceover, stopVoiceover } = useVoiceoverRecorder();

  return (
    <button
      type="button"
      onClick={voiceoverActive ? stopVoiceover : startVoiceover}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-all cursor-pointer select-none ${
        voiceoverActive
          ? "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.4)]"
          : "bg-surface-raised border-border/60 text-text-muted hover:text-text-primary hover:border-accent/40"
      }`}
      title={voiceoverActive ? "Stop Voiceover Recording" : "Record Live Voiceover at Playhead"}
    >
      {voiceoverActive ? (
        <>
          <Square className="w-3 h-3 text-red-400 fill-current" />
          <span>Recording Voiceover...</span>
        </>
      ) : (
        <>
          <Mic className="w-3.5 h-3.5 text-accent" />
          <span>Record Voiceover</span>
        </>
      )}
    </button>
  );
};
