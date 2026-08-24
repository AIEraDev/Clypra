/**
 * useTimelineCommands Hook
 *
 * Resolves timeline empty space and track command availability.
 */

import { useMemo, useState, useEffect } from "react";
import { useTimelineStore } from "@/store/timelineStore";
import { useShortcutStore, formatBinding } from "@/store/shortcutStore";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { clipboardService } from "@/core/clipboard/clipboardService";
import { timelineCommands } from "./timelineCommands";
import type { TimelineCommand, TimelineCommandContext, TimelineCommandGroup } from "./types";

export interface ResolvedTimelineCommand {
  command: TimelineCommand;
  isEnabled: boolean;
  isVisible: boolean;
  shortcutLabel?: string;
  disabledReason?: string;
}

export interface GroupedTimelineCommands {
  group: TimelineCommandGroup;
  items: ResolvedTimelineCommand[];
}

const GROUP_ORDER: TimelineCommandGroup[] = ["clipboard", "gap", "track"];

export function useTimelineCommands(clickedTrackId: string | null, clickedTime: number) {
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  const [clipboardVersion, setClipboardVersion] = useState(0);
  useEffect(() => {
    return clipboardService.subscribe(() => setClipboardVersion((v) => v + 1));
  }, []);

  const resolvedCommands = useMemo(() => {
    const playheadTime = getPlaybackClock().time;
    const ctx: TimelineCommandContext = {
      clickedTrackId,
      clickedTime,
      playheadTime,
      tracks,
      clips,
      hasClipboard: clipboardService.hasClips(),
    };

    return timelineCommands.map((command): ResolvedTimelineCommand => {
      const isVisible = command.isVisible(ctx);
      const isEnabled = isVisible && command.isEnabled(ctx);
      const disabledReason = !isEnabled && isVisible && command.disabledReason ? command.disabledReason(ctx) : undefined;

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
  }, [tracks, clips, clickedTrackId, clickedTime, shortcuts, clipboardVersion]);

  const groupedCommands = useMemo(() => {
    const visibleCommands = resolvedCommands.filter((r) => r.isVisible);
    const groups: GroupedTimelineCommands[] = [];

    GROUP_ORDER.forEach((groupName) => {
      const items = visibleCommands.filter((r) => r.command.group === groupName);
      if (items.length > 0) {
        groups.push({ group: groupName, items });
      }
    });

    return groups;
  }, [resolvedCommands]);

  const executeCommand = (commandId: string) => {
    const item = timelineCommands.find((c) => c.id === commandId);
    if (!item) return;

    const playheadTime = getPlaybackClock().time;
    const ctx: TimelineCommandContext = {
      clickedTrackId,
      clickedTime,
      playheadTime,
      tracks,
      clips,
      hasClipboard: clipboardService.hasClips(),
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
