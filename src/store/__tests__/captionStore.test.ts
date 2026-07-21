import { beforeEach, describe, expect, test } from "vitest";
import {
  type CaptionSettings,
  type ModelDownloadState,
  useCaptionStore,
} from "../captionStore";

const IDLE_MODEL: ModelDownloadState = {
  status: "idle",
  progressBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
};

function defaultCaptionSettings(): CaptionSettings {
  return {
    language: "auto",
    activeModel: null,
    languageHints: [],
    models: {
      tiny: { ...IDLE_MODEL },
      base: { ...IDLE_MODEL },
      small: { ...IDLE_MODEL },
      medium: { ...IDLE_MODEL },
      "large-v3": { ...IDLE_MODEL },
    },
  };
}

describe("captionStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useCaptionStore.setState({ captionSettings: defaultCaptionSettings() });
  });

  test("resets an interrupted download to idle when the store rehydrates after restart", async () => {
    const persistedCaptionSettings: CaptionSettings = {
      language: "zh",
      activeModel: "base",
      languageHints: ["en", "ja"],
      models: {
        tiny: {
          status: "downloading",
          progressBytes: 12_345,
          totalBytes: 75_000_000,
          speedBytesPerSec: 9_876,
          errorMessage: "stale detail",
        },
        base: {
          status: "downloaded",
          progressBytes: 74_000_000,
          totalBytes: 74_000_000,
          speedBytesPerSec: 0,
        },
        small: {
          status: "error",
          progressBytes: 0,
          totalBytes: 466_000_000,
          speedBytesPerSec: 0,
          errorMessage: "HTTP 503",
        },
        medium: { ...IDLE_MODEL },
        "large-v3": { ...IDLE_MODEL },
      },
    };
    localStorage.setItem(
      "clypra-caption-settings",
      JSON.stringify({ state: { captionSettings: persistedCaptionSettings }, version: 0 }),
    );

    await useCaptionStore.persist.rehydrate();

    const { captionSettings } = useCaptionStore.getState();
    expect(captionSettings.models.tiny).toEqual(IDLE_MODEL);
    expect(captionSettings.models.base).toEqual(
      persistedCaptionSettings.models.base,
    );
    expect(captionSettings.models.small).toEqual(
      persistedCaptionSettings.models.small,
    );
    expect(captionSettings).toMatchObject({
      language: "zh",
      activeModel: "base",
      languageHints: ["en", "ja"],
    });
  });

  test("ignores malformed persisted caption settings without breaking rehydration", async () => {
    localStorage.setItem(
      "clypra-caption-settings",
      JSON.stringify({
        state: {
          captionSettings: {
            language: "ja",
            activeModel: "small",
            languageHints: ["en", 42, "zh"],
            models: {
              tiny: null,
              base: "downloaded",
              small: {
                status: "complete",
                progressBytes: 1,
                totalBytes: 1,
                speedBytesPerSec: 0,
              },
              medium: {
                status: "downloaded",
                progressBytes: "unknown",
                totalBytes: 1_500_000_000,
                speedBytesPerSec: 0,
              },
              "large-v3": {
                status: "downloading",
                progressBytes: 123,
                totalBytes: 3_000_000_000,
                speedBytesPerSec: 456,
                errorMessage: "stale detail",
              },
            },
          },
          setLanguage: "persisted action must not replace store actions",
        },
        version: 0,
      }),
    );

    await expect(useCaptionStore.persist.rehydrate()).resolves.toBeUndefined();

    const state = useCaptionStore.getState();
    expect(state.captionSettings).toEqual({
      language: "ja",
      activeModel: "small",
      languageHints: ["en", "zh"],
      models: {
        tiny: IDLE_MODEL,
        base: IDLE_MODEL,
        small: IDLE_MODEL,
        medium: IDLE_MODEL,
        "large-v3": IDLE_MODEL,
      },
    });
    expect(state.setLanguage).toBeTypeOf("function");
  });
});
