import React from "react";
import { ContextMenu, type ContextMenuGroup } from "@/components/ui/ContextMenu";
import { useTimelineCommands } from "@/core/commands";

export interface TrackContextMenuProps {
  trackId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Context menu shown when right-clicking a track label.
 *
 * Renders the full set of track-scoped commands from timelineCommands,
 * with clickedTrackId pre-populated and clickedTime as 0 (label clicks
 * are not time-positioned).
 */
export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  trackId,
  position,
  onClose,
}) => {
  const { groupedCommands, executeCommand } = useTimelineCommands(trackId, 0);

  const groups: ContextMenuGroup[] = groupedCommands.map((grp) => ({
    items: grp.items.map((resolved) => ({
      id: resolved.command.id,
      label: resolved.command.label,
      icon: resolved.command.icon,
      shortcut: resolved.shortcutLabel,
      danger: resolved.command.danger,
      disabled: !resolved.isEnabled,
      disabledReason: resolved.disabledReason,
      onClick: () => {
        executeCommand(resolved.command.id);
        onClose();
      },
    })),
  }));

  return <ContextMenu groups={groups} position={position} onClose={onClose} />;
};
