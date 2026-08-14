import { describe, it, expect, beforeEach } from "vitest";
import { useCaptionStore } from "../captionStore";

describe("captionStore — Whisper Model & Caption Settings", () => {
  beforeEach(() => {
    useCaptionStore.setState({
      captionSettings: {
        language: "auto",
        activeModel: null,
        languageHints: [],
        models: {
          tiny: { status: "idle", progressBytes: 0, totalBytes: 0, speedBytesPerSec: 0 },
          base: { status: "idle", progressBytes: 0, totalBytes: 0, speedBytesPerSec: 0 },
          small: { status: "idle", progressBytes: 0, totalBytes: 0, speedBytesPerSec: 0 },
          medium: { status: "idle", progressBytes: 0, totalBytes: 0, speedBytesPerSec: 0 },
          "large-v3": { status: "idle", progressBytes: 0, totalBytes: 0, speedBytesPerSec: 0 },
        },
      },
    });
  });

  it("updates active model and target language", () => {
    const { setLanguage, setActiveModel } = useCaptionStore.getState();

    setLanguage("en");
    setActiveModel("base");

    expect(useCaptionStore.getState().captionSettings.language).toBe("en");
    expect(useCaptionStore.getState().captionSettings.activeModel).toBe("base");
  });

  it("tracks Whisper model download state and progress", () => {
    const { updateModelDownloadState } = useCaptionStore.getState();

    updateModelDownloadState("small", {
      status: "downloading",
      progressBytes: 500000,
      totalBytes: 1000000,
      speedBytesPerSec: 50000,
    });

    const smallModel = useCaptionStore.getState().captionSettings.models.small;
    expect(smallModel.status).toBe("downloading");
    expect(smallModel.progressBytes).toBe(500000);
    expect(smallModel.totalBytes).toBe(1000000);

    updateModelDownloadState("small", {
      status: "downloaded",
    });

    expect(useCaptionStore.getState().captionSettings.models.small.status).toBe("downloaded");
  });

  it("updates language hints list", () => {
    const { setLanguageHints } = useCaptionStore.getState();

    setLanguageHints(["en", "es", "ja"]);
    expect(useCaptionStore.getState().captionSettings.languageHints).toEqual(["en", "es", "ja"]);
  });

  it("manages subtitle segments and clearSegments action", () => {
    const mockSegments = [
      {
        id: 0,
        text: "Hello world",
        startMs: 0,
        endMs: 1500,
        words: [
          { word: "Hello", startMs: 0, endMs: 750 },
          { word: "world", startMs: 750, endMs: 1500 },
        ],
      },
    ];

    useCaptionStore.setState({ segments: mockSegments });
    expect(useCaptionStore.getState().segments).toHaveLength(1);
    expect(useCaptionStore.getState().segments[0].words).toHaveLength(2);

    useCaptionStore.getState().clearSegments();
    expect(useCaptionStore.getState().segments).toHaveLength(0);
  });

  it("manages karaoke overlay toggle and styling customizations", () => {
    const { setKaraokeOverlayEnabled, setKaraokeStyle } = useCaptionStore.getState();

    expect(useCaptionStore.getState().karaokeOverlayEnabled).toBe(false);
    setKaraokeOverlayEnabled(true);
    expect(useCaptionStore.getState().karaokeOverlayEnabled).toBe(true);

    setKaraokeStyle({
      activeColor: "#00ffff",
      fontSize: 42,
      position: "middle",
    });

    const style = useCaptionStore.getState().karaokeStyle;
    expect(style.activeColor).toBe("#00ffff");
    expect(style.fontSize).toBe(42);
    expect(style.position).toBe("middle");
  });
});
