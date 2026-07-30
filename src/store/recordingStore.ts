import { create } from "zustand";

export interface RecordingResult {
  filePaths: string[];
  metadata?: {
    screenStartPerfTime?: number;
    webcamStartPerfTime?: number;
    cameraOffsetSeconds?: number;
  };
}

export interface RecordingState {
  isRecording: boolean;
  seconds: number;
  hasWebcam: boolean;
  previewRecording: RecordingResult | null;
  /** Error surfaced from MediaRecorder/track lifecycle — shown in FloatingWidget */
  recordingError: string | null;

  // Voiceover Direct Recording
  voiceoverActive: boolean;
  voiceoverStartTimelineTime: number;
  voiceoverAudioBlob: Blob | null;

  setIsRecording: (v: boolean) => void;
  setSeconds: (updater: number | ((prev: number) => number)) => void;
  setHasWebcam: (v: boolean) => void;
  setPreviewRecording: (v: RecordingResult | null) => void;
  setRecordingError: (v: string | null) => void;

  setVoiceoverActive: (v: boolean, startTimelineTime?: number) => void;
  setVoiceoverAudioBlob: (blob: Blob | null) => void;

  reset: () => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  isRecording: false,
  seconds: 0,
  hasWebcam: true,
  previewRecording: null,
  recordingError: null,

  voiceoverActive: false,
  voiceoverStartTimelineTime: 0,
  voiceoverAudioBlob: null,

  setIsRecording: (v) => set({ isRecording: v }),
  setSeconds: (updater) =>
    set((state) => ({
      seconds: typeof updater === "function" ? updater(state.seconds) : updater,
    })),
  setHasWebcam: (v) => set({ hasWebcam: v }),
  setPreviewRecording: (v) => set({ previewRecording: v }),
  // REC-07 fix: Stop recording state when an error is set, so the timer and UI stop.
  setRecordingError: (v) => set({ recordingError: v, ...(v ? { isRecording: false } : {}) }),

  setVoiceoverActive: (v, startTimelineTime = 0) => set({ voiceoverActive: v, voiceoverStartTimelineTime: startTimelineTime }),
  setVoiceoverAudioBlob: (blob) => set({ voiceoverAudioBlob: blob }),

  reset: () => set({ isRecording: false, seconds: 0, hasWebcam: true, previewRecording: null, recordingError: null, voiceoverActive: false, voiceoverStartTimelineTime: 0, voiceoverAudioBlob: null }),
}));

