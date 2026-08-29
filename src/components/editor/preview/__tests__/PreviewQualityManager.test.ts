import { describe, expect, it } from "vitest";
import {
  PreviewQualityManager,
  PreviewQualityTier,
} from "../PreviewQualityManager";

describe("PreviewQualityManager", () => {
  it("selects the configured playback tier instead of silently using full output", () => {
    const manager = new PreviewQualityManager({
      sequenceWidth: 1920,
      sequenceHeight: 1080,
      viewportWidth: 1200,
      viewportHeight: 700,
      dpr: 2,
    });

    expect(manager.selectTierForInteraction(true, false, false, "high")).toBe(
      PreviewQualityTier.PlaybackHigh,
    );
    expect(manager.selectTierForInteraction(true, false, false, "medium")).toBe(
      PreviewQualityTier.Playback,
    );
    expect(manager.selectTierForInteraction(true, false, false, "low")).toBe(
      PreviewQualityTier.Interaction,
    );
    expect(manager.selectTierForInteraction(true, false, false, "full")).toBe(
      PreviewQualityTier.Idle,
    );
  });

  it("keeps interaction output materially smaller than playback output", () => {
    const manager = new PreviewQualityManager({
      sequenceWidth: 1920,
      sequenceHeight: 1080,
      viewportWidth: 1600,
      viewportHeight: 900,
      dpr: 2,
    });

    const playback = manager.getRenderProfile(PreviewQualityTier.PlaybackHigh);
    const interaction = manager.getRenderProfile(PreviewQualityTier.Interaction);

    expect(playback.maxWidth).toBe(1440);
    expect(playback.maxHeight).toBe(810);
    expect(interaction.maxWidth).toBe(480);
    expect(interaction.maxHeight).toBe(270);
    expect(interaction.maxWidth * interaction.maxHeight).toBeLessThan(
      playback.maxWidth * playback.maxHeight,
    );
  });

  it("never emits zero dimensions while the preview viewport is settling", () => {
    const manager = new PreviewQualityManager({
      sequenceWidth: 1920,
      sequenceHeight: 1080,
      viewportWidth: 0,
      viewportHeight: 0,
      dpr: 2,
    });

    expect(manager.getSafeMaxDimensions()).toEqual({ width: 1, height: 1 });
  });

  it("keeps play and pause on the same configured preview tier", () => {
    const manager = new PreviewQualityManager({
      sequenceWidth: 1920,
      sequenceHeight: 1080,
      viewportWidth: 1200,
      viewportHeight: 700,
      dpr: 2,
    });

    expect(manager.selectTierForPreview(false, "high")).toBe(
      PreviewQualityTier.PlaybackHigh,
    );
    expect(manager.selectTierForPreview(false, "medium")).toBe(
      PreviewQualityTier.Playback,
    );
    expect(manager.selectTierForPreview(false, "full")).toBe(
      PreviewQualityTier.Idle,
    );
    expect(manager.selectTierForPreview(true, "high")).toBe(
      PreviewQualityTier.Interaction,
    );
  });
});
