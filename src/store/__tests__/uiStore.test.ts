import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../uiStore";

describe("uiStore — Ephemeral UI Interaction State", () => {
  beforeEach(() => {
    useUIStore.setState({
      selectedClipIds: [],
      selectedGapId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
      previewMediaId: null,
      activePanel: "media",
      showExportModal: false,
      showNewProjectModal: false,
      showSettingsModal: false,
      previewMode: "program",
      sourceAsset: null,
      sourceTextPreset: null,
      sourceInPoint: null,
      sourceOutPoint: null,
    });
  });

  it("handles clip selection and clear selection", () => {
    const { selectClip, clearSelection } = useUIStore.getState();

    selectClip("clip-1");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-1"]);

    clearSelection();
    expect(useUIStore.getState().selectedClipIds).toEqual([]);
  });

  it("handles multi-clip selection toggling", () => {
    const { toggleClipSelection } = useUIStore.getState();

    toggleClipSelection("clip-1");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-1"]);

    toggleClipSelection("clip-2");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-1", "clip-2"]);

    toggleClipSelection("clip-1");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-2"]);
  });

  it("mutually excludes gap selection with clip selection", () => {
    const { selectClip, selectGap } = useUIStore.getState();

    selectClip("clip-1");
    expect(useUIStore.getState().selectedClipIds).toEqual(["clip-1"]);

    selectGap("gap-123");
    expect(useUIStore.getState().selectedGapId).toBe("gap-123");
    expect(useUIStore.getState().selectedClipIds).toEqual([]);
  });

  it("handles modal toggles", () => {
    const { toggleExportModal, toggleSettingsModal, toggleNewProjectModal } = useUIStore.getState();

    toggleExportModal();
    expect(useUIStore.getState().showExportModal).toBe(true);

    toggleSettingsModal();
    expect(useUIStore.getState().showSettingsModal).toBe(true);

    toggleNewProjectModal();
    expect(useUIStore.getState().showNewProjectModal).toBe(true);
  });

  it("manages source mode asset preview and in/out points", () => {
    const { previewAsset, markSourceIn, markSourceOut, exitSourceMode } = useUIStore.getState();

    previewAsset({
      id: "media-1",
      name: "Video 1",
      path: "/path/video.mp4",
      type: "video",
      duration: 10,
      size: 1024,
    } as any);

    expect(useUIStore.getState().previewMode).toBe("source");
    expect(useUIStore.getState().sourceAsset?.id).toBe("media-1");

    markSourceIn(2.5);
    markSourceOut(7.5);
    expect(useUIStore.getState().sourceInPoint).toBe(2.5);
    expect(useUIStore.getState().sourceOutPoint).toBe(7.5);

    exitSourceMode();
    expect(useUIStore.getState().previewMode).toBe("program");
    expect(useUIStore.getState().sourceAsset).toBeNull();
  });
});
