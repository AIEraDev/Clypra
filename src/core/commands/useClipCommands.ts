/**
 * useClipCommands Hook
 *
 * Resolves clip command availability, enable/disable states, and dynamic
 * shortcut labels for a given context menu invocation or toolbar action.
 */

import { useMemo, useState, useEffect } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useShortcutStore, formatBinding } from "@/store/shortcutStore";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { clipCommands } from "./clipCommands";
import type { ClipCommand, ClipCommandContext, ClipCommandGroup } from "./types";

export interface ResolvedClipCommand {
  command: ClipCommand;
  isEnabled: boolean;
  isVisible: boolean;
  shortcutLabel?: string;
  disabledReason?: string;
}

export interface GroupedClipCommands {
  group: ClipCommandGroup;
  items: ResolvedClipCommand[];
}

const GROUP_ORDER: ClipCommandGroup[] = [
  "clipboard",
  "trim",
  "speed",
  "audio",
  "enable",
  "organize",
  "media",
  "info",
];

export function useClipCommands(clickedClipId: string | null, clickedTrackId?: string | null) {
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedClipIds = useUIStore((s) => s.selectedClipIds);
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  // Subscribe to clipboard changes to update paste enabled state
  const [clipboardVersion, setClipboardVersion] = useState(0);
  useEffect(() => {
    return clipboardService.subscribe(() => setClipboardVersion((v) => v + 1));
  }, []);

  const resolvedCommands = useMemo(() => {
    const playheadTime = getPlaybackClock().time;
    const ctx: ClipCommandContext = {
      selectedClipIds,
      clickedClipId,
      clickedTrackId,
      playheadTime,
      clips,
      tracks,
    };

    return clipCommands.map((command): ResolvedClipCommand => {
      const isVisible = command.isVisible(ctx);
      const isEnabled = isVisible && command.isEnabled(ctx);
      const disabledReason = !isEnabled && isVisible && command.disabledReason ? command.disabledReason(ctx) : undefined;

      // Dynamic shortcut binding lookup if shortcutId is present
      let shortcutLabel = command.shortcutLabel;
      if (command.shortcutId && shortcuts[command.shortcutId]) {
        shortcutLabel = formatBinding(shortcuts[command.shortcutId].binding);
      }

      return {
        command,
        isEnabled,
        isVisible,
        shortcutLabel,
        disabledReason,
      };
    });
  }, [clips, tracks, selectedClipIds, clickedClipId, clickedTrackId, shortcuts, clipboardVersion]);

  const groupedCommands = useMemo(() => {
    const visibleCommands = resolvedCommands.filter((r) => r.isVisible);
    const groups: GroupedClipCommands[] = [];

    GROUP_ORDER.forEach((groupName) => {
      const items = visibleCommands.filter((r) => r.command.group === groupName);
      if (items.length > 0) {
        groups.push({ group: groupName, items });
      }
    });

    return groups;
  }, [resolvedCommands]);

  const executeCommand = (commandId: string) => {
    const item = clipCommands.find((c) => c.id === commandId);
    if (!item) return;

    const playheadTime = getPlaybackClock().time;
    const ctx: ClipCommandContext = {
      selectedClipIds,
      clickedClipId,
      clickedTrackId,
      playheadTime,
      clips,
      tracks,
    };

    if (item.isEnabled(ctx)) {
      item.execute(ctx);
    }
  };

  return {
    resolvedCommands,
    groupedCommands,
    executeCommand,
  };
}
