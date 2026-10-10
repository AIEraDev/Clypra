import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrackLabel } from "../TrackLabel";
import { I18nProvider } from "@/i18n/I18nProvider";
import i18nInstance from "@/i18n/i18nInstance";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Track } from "@/types";

describe("TrackLabel localization and controls", () => {
  const sampleTrack: Track = {
    id: "track-test-1",
    type: "video",
    name: "Video 1",
    muted: false,
    locked: false,
    visible: true,
    solo: false,
    height: 68,
  };

  beforeEach(async () => {
    localStorage.clear();
    await i18nInstance.changeLanguage("en");
    useTimelineStore.setState({
      tracks: [sampleTrack],
      clips: [],
      gaps: [],
      mainVideoTrackId: "track-test-1",
    });
    useUIStore.setState({
      selectedTrackId: null,
    });
  });

  it("renders default English aria-labels and tooltips", () => {
    render(
      <I18nProvider>
        <TrackLabel track={sampleTrack} />
      </I18nProvider>
    );

    expect(screen.getByRole("button", { name: "Lock track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solo track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute track" })).toBeInTheDocument();
  });

  it("renders localized labels when switched to Russian", async () => {
    localStorage.setItem("clypra.language", "ru");
    await i18nInstance.changeLanguage("ru");
    render(
      <I18nProvider>
        <TrackLabel track={sampleTrack} />
      </I18nProvider>
    );

    // In ru catalog: timeline.tracks.lock is "Заблокировать дорожку"
    expect(screen.getByRole("button", { name: "Заблокировать дорожку" })).toBeInTheDocument();
    // In ru catalog: timeline.tracks.hide is "Скрыть дорожку"
    expect(screen.getByRole("button", { name: "Скрыть дорожку" })).toBeInTheDocument();
    // In ru catalog: timeline.tracks.solo is "Соло дорожки"
    expect(screen.getByRole("button", { name: "Соло дорожки" })).toBeInTheDocument();
  });

  it("toggles to unlock and show when track is locked and hidden", () => {
    const modifiedTrack: Track = {
      ...sampleTrack,
      locked: true,
      visible: false,
      muted: true,
      solo: true,
    };

    render(
      <I18nProvider>
        <TrackLabel track={modifiedTrack} />
      </I18nProvider>
    );

    expect(screen.getByRole("button", { name: "Unlock track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unsolo track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unmute track" })).toBeInTheDocument();
  });
});
