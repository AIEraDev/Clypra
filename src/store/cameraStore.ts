import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CameraAspectRatio,
  CameraResolution,
  CameraFrameRate,
  CameraDevice,
  AudioDevice,
} from "@/services/cameraRecordService";

export type { CameraAspectRatio, CameraDevice, AudioDevice };

/** Lifecycle state of the native camera preview loop. */
export type CameraPreviewState = "idle" | "initializing" | "live" | "error";

export interface CameraState {
  /** Whether the camera modal is open */
  cameraModalOpen: boolean;
  /** Whether a recording is currently in progress */
  isRecording: boolean;
  /** Elapsed recording seconds */
  recordingSeconds: number;

  // ── User preferences (persisted) ──────────────────────────────────────────
  /** User-selected aspect ratio */
  selectedAspectRatio: CameraAspectRatio;
  /** User-selected camera device id */
  selectedCameraDeviceId: string | null;
  /** User-selected mic device id */
  selectedMicDeviceId: string | null;
  /** Resolution preference */
  selectedResolution: CameraResolution;
  /** Frame rate preference */
  selectedFrameRate: CameraFrameRate;
  /** Mic enabled toggle */
  micEnabled: boolean;

  // ── Session state (not persisted) ─────────────────────────────────────────
  /** Native preview lifecycle: idle → initializing → live | error */
  previewState: CameraPreviewState;
  /** Cameras enumerated from the backend after permission is granted */
  availableCameras: CameraDevice[];
  /** Available audio input devices (from navigator.mediaDevices) */
  availableMics: Array<{ deviceId: string; label: string }>;
  /** Error message to show in the modal */
  cameraError: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  openCameraModal: () => void;
  closeCameraModal: () => void;
  setIsRecording: (v: boolean) => void;
  setRecordingSeconds: (updater: number | ((prev: number) => number)) => void;
  setSelectedAspectRatio: (v: CameraAspectRatio) => void;
  setSelectedCameraDeviceId: (id: string | null) => void;
  setSelectedMicDeviceId: (id: string | null) => void;
  setSelectedResolution: (v: CameraResolution) => void;
  setSelectedFrameRate: (v: CameraFrameRate) => void;
  setMicEnabled: (v: boolean) => void;
  setPreviewState: (v: CameraPreviewState) => void;
  setAvailableCameras: (cameras: CameraDevice[]) => void;
  setAvailableMics: (mics: Array<{ deviceId: string; label: string }>) => void;
  setCameraError: (v: string | null) => void;
  resetSession: () => void;
}

export const useCameraStore = create<CameraState>()(
  persist(
    (set) => ({
      cameraModalOpen: false,
      isRecording: false,
      recordingSeconds: 0,

      // persisted prefs
      selectedAspectRatio: "9:16",
      selectedCameraDeviceId: null,
      selectedMicDeviceId: null,
      selectedResolution: "1080p",
      selectedFrameRate: 30,
      micEnabled: true,

      // session state (reset on open)
      previewState: "idle",
      availableCameras: [],
      availableMics: [],
      cameraError: null,

      openCameraModal: () =>
        set({ cameraModalOpen: true, cameraError: null, previewState: "idle" }),
      closeCameraModal: () => set({ cameraModalOpen: false }),
      setIsRecording: (v) => set({ isRecording: v }),
      setRecordingSeconds: (updater) =>
        set((state) => ({
          recordingSeconds:
            typeof updater === "function"
              ? updater(state.recordingSeconds)
              : updater,
        })),
      setSelectedAspectRatio: (v) => set({ selectedAspectRatio: v }),
      setSelectedCameraDeviceId: (id) => set({ selectedCameraDeviceId: id }),
      setSelectedMicDeviceId: (id) => set({ selectedMicDeviceId: id }),
      setSelectedResolution: (v) => set({ selectedResolution: v }),
      setSelectedFrameRate: (v) => set({ selectedFrameRate: v }),
      setMicEnabled: (v) => set({ micEnabled: v }),
      setPreviewState: (v) => set({ previewState: v }),
      setAvailableCameras: (cameras) => set({ availableCameras: cameras }),
      setAvailableMics: (mics) => set({ availableMics: mics }),
      setCameraError: (v) => set({ cameraError: v }),
      resetSession: () =>
        set({
          isRecording: false,
          recordingSeconds: 0,
          cameraError: null,
          cameraModalOpen: false,
          previewState: "idle",
          availableCameras: [],
          availableMics: [],
        }),
    }),
    {
      name: "clypra-camera-prefs",
      // Only persist user preferences — never transient session state
      partialize: (state) => ({
        selectedAspectRatio: state.selectedAspectRatio,
        selectedCameraDeviceId: state.selectedCameraDeviceId,
        selectedMicDeviceId: state.selectedMicDeviceId,
        selectedResolution: state.selectedResolution,
        selectedFrameRate: state.selectedFrameRate,
        micEnabled: state.micEnabled,
      }),
    },
  ),
);
