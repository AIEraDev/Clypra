import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipCommands } from "../useClipCommands";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useShortcutStore } from "@/store/shortcutStore";
import { clipboardService } from "@/core/clipboard/clipboardService";

describe("useClipCommands hook dynamic shortcut and state resolution", () => {
  beforeEach(() => {
    clipboardService.clear();
    useShortcutStore.getState().resetAll();
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [
        {
          id: "clip-1",
          trackId: "track-1",
          mediaId: "asset-1",
          startTime: 0,
          duration: 10,
          trimIn: 0,
          trimOut: 10,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
          volume: 1.0,
        } as any,
      ],
    });
    useUIStore.setState({ selectedClipIds: ["clip-1"] });
  });

  it("updates shortcut labels when active shortcut preset changes", () => {
    const { result } = renderHook(() => useClipCommands("clip-1", "track-1"));

    // Clypra default for split-selected-at-playhead is Ctrl/Cmd+K -> formatBinding returns ⌘ K (or Ctrl K)
    const splitDefault = result.current.resolvedCommands.find((r) => r.command.id === "clip.splitAtPlayhead")!;
    expect(splitDefault.shortcutLabel).toContain("K");

    // Change shortcut binding for split-selected-at-playhead
    act(() => {
      useShortcutStore.getState().setShortcut("split-selected-at-playhead", { key: "x", ctrl: true });
    });

    const splitCustom = result.current.resolvedCommands.find((r) => r.command.id === "clip.splitAtPlayhead")!;
    expect(splitCustom.shortcutLabel).toContain("X");
  });

  it("updates paste command availability in real-time when clipboard items change", () => {
    const { result } = renderHook(() => useClipCommands("clip-1", "track-1"));

    const pasteCmdBefore = result.current.resolvedCommands.find((r) => r.command.id === "clip.paste")!;
    expect(pasteCmdBefore.isEnabled).toBe(false);

    // Copy to clipboard
    act(() => {
      clipboardService.copyClips(["clip-1"]);
    });

    const pasteCmdAfter = result.current.resolvedCommands.find((r) => r.command.id === "clip.paste")!;
    expect(pasteCmdAfter.isEnabled).toBe(true);
  });
});
