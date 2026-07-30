import { useRef, useCallback } from "react";
import { useRecordingStore } from "@/store/recordingStore";
import { useTimelineStore, getInsertIndexForNewTrack } from "@/store/timelineStore";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import { createAudioClip } from "@/lib/timeline/timelineClip";

export function useVoiceoverRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);

  const { voiceoverActive, setVoiceoverActive, setVoiceoverAudioBlob, setRecordingError } = useRecordingStore();
  const { time: currentTime } = usePlaybackClock();

  const startVoiceover = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setVoiceoverAudioBlob(audioBlob);

        // Convert audio blob to Object URL for audio playback
        const audioUrl = URL.createObjectURL(audioBlob);
        const duration = Math.max(0.5, (Date.now() - startTimeRef.current) / 1000);

        // Find or create Audio Track
        const timeline = useTimelineStore.getState();
        let audioTrack = timeline.tracks.find((t) => t.type === "audio" && t.name.toLowerCase().includes("voiceover")) || timeline.tracks.find((t) => t.type === "audio");

        let targetTrackId: string;
        if (audioTrack) {
          targetTrackId = audioTrack.id;
        } else {
          const insertIndex = getInsertIndexForNewTrack(timeline.tracks, "audio");
          targetTrackId = timeline.insertTrackAt("audio", insertIndex);
          useTimelineStore.setState((state) => ({
            tracks: state.tracks.map((t) => (t.id === targetTrackId ? { ...t, name: "Voiceover" } : t)),
          }));
        }

        // Add Voiceover clip to target audio track
        const newClip = createAudioClip({
          trackId: targetTrackId,
          name: `Voiceover ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          startTime: useRecordingStore.getState().voiceoverStartTimelineTime,
          duration,
          path: audioUrl,
        });

        timeline.addClip(newClip);

        // Clean up stream tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      startTimeRef.current = Date.now();
      setVoiceoverActive(true, currentTime);
      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
    } catch (err: any) {
      console.error("[VoiceoverRecorder] Microphone access failed:", err);
      setRecordingError(err?.message || "Microphone access denied or unavailable.");
    }
  }, [currentTime, setVoiceoverActive, setVoiceoverAudioBlob, setRecordingError]);

  const stopVoiceover = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setVoiceoverActive(false);
  }, [setVoiceoverActive]);

  return {
    voiceoverActive,
    startVoiceover,
    stopVoiceover,
  };
}
