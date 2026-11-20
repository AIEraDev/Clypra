import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ExportPresetCard,
  type ExportPreset,
  type PresetConfig,
} from "../ExportPresetCard";

/**
 * Regression guard for the design-token migration of ExportPresetCard.
 *
 * The non-selected state previously used raw `white/N` opacity utilities
 * (`bg-white/2`, `border-white/6`, `hover:bg-white/4`, `hover:border-white/10`)
 * which are not theme-aware and break in light mode. These tests assert the
 * card now uses canonical semantic tokens and that the selected/disabled
 * behaviors are preserved, preventing accidental reversion to raw-white.
 */
describe("ExportPresetCard design-token styling", () => {
  const presetKey: ExportPreset = "1080p-fast";
  const config: PresetConfig = {
    label: "1080p Fast",
    shortLabel: "1080p",
    resolution: "1920×1080",
    codec: "h264",
    codecLabel: "H.264",
    tier: "fast",
    tierLabel: "Fast",
    width: 1920,
    height: 1080,
    codecValue: "h264",
    preset: "ultrafast",
    crf: 23,
    pixelFormat: "yuv420p",
    estimatedBitrateMbps: 8,
  };

  it("uses semantic surface/border tokens for the non-selected state (no raw-white)", () => {
    render(
      <ExportPresetCard
        presetKey={presetKey}
        config={config}
        selected={false}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.className).toContain("bg-surface-raised/40");
    expect(button.className).toContain("border-border/40");
    expect(button.className).toContain("hover:bg-surface-hover");
    // Guard against reversion to raw white-opacity utilities.
    expect(button.className).not.toContain("bg-white");
    expect(button.className).not.toContain("border-white");
    expect(button.className).not.toContain("hover:bg-white");
    expect(button.className).not.toContain("hover:border-white");
  });

  it("uses accent tokens and aria-pressed for the selected state", () => {
    render(
      <ExportPresetCard
        presetKey={presetKey}
        config={config}
        selected={true}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("bg-accent/10");
    expect(button.className).toContain("border-accent/40");
    expect(button.className).toContain("ring-accent/20");
    expect(button.className).not.toContain("bg-white");
  });

  it("applies the disabled treatment and native disabled attribute", () => {
    render(
      <ExportPresetCard
        presetKey={presetKey}
        config={config}
        selected={false}
        disabled={true}
        onSelect={vi.fn()}
      />,
    );

    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.className).toContain("opacity-40");
    expect(button.className).toContain("cursor-not-allowed");
  });

  it("uses a semantic elevated surface for the non-selected codec badge", () => {
    render(
      <ExportPresetCard
        presetKey={presetKey}
        config={config}
        selected={false}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const badge = screen.getByText("H.264");
    expect(badge.className).toContain("bg-surface-elevated");
    expect(badge.className).not.toContain("bg-white");
  });

  it("uses accent for the selected codec badge", () => {
    render(
      <ExportPresetCard
        presetKey={presetKey}
        config={config}
        selected={true}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const badge = screen.getByText("H.264");
    expect(badge.className).toContain("bg-accent/15");
    expect(badge.className).toContain("text-accent");
  });

  it("invokes onSelect when clicked in the enabled, non-selected state", () => {
    const onSelect = vi.fn();
    render(
      <ExportPresetCard
        presetKey={presetKey}
        config={config}
        selected={false}
        disabled={false}
        onSelect={onSelect}
      />,
    );

    screen.getByRole("button").click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
