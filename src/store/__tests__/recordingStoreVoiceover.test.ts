import { describe, it, expect, beforeEach } from "vitest";
import { useRecordingStore } from "../recordingStore";

describe("recordingStore — Voiceover Timeline Recording State", () => {
  beforeEach(() => {
    useRecordingStore.getState().reset();
  });

  it("manages voiceover active state and timeline playhead start time", () => {
    const { setVoiceoverActive, setVoiceoverAudioBlob } = useRecordingStore.getState();

    setVoiceoverActive(true, 12.5);
    expect(useRecordingStore.getState().voiceoverActive).toBe(true);
    expect(useRecordingStore.getState().voiceoverStartTimelineTime).toBe(12.5);

    const dummyBlob = new Blob(["test-audio"], { type: "audio/webm" });
    setVoiceoverAudioBlob(dummyBlob);
    expect(useRecordingStore.getState().voiceoverAudioBlob).toBe(dummyBlob);

    setVoiceoverActive(false);
    expect(useRecordingStore.getState().voiceoverActive).toBe(false);
  });
});
