import React from "react";
import { ContextMenu, type ContextMenuGroup } from "@/components/ui/ContextMenu";
import { useTimelineCommands } from "@/core/commands";

export interface TimelineEmptySpaceContextMenuProps {
  clickedTrackId: string | null;
  clickedTime: number;
  position: { x: number; y: number };
  onClose: () => void;
}

export const TimelineEmptySpaceContextMenu: React.FC<TimelineEmptySpaceContextMenuProps> = ({
  clickedTrackId,
  clickedTime,
  position,
  onClose,
}) => {
  const { groupedCommands, executeCommand } = useTimelineCommands(clickedTrackId, clickedTime);

  const groups: ContextMenuGroup[] = groupedCommands.map((grp) => ({
    items: grp.items.map((resolved) => ({
      id: resolved.command.id,
      label: resolved.command.label,
      icon: resolved.command.icon,
      shortcut: resolved.shortcutLabel,
      danger: resolved.command.danger,
      disabled: !resolved.isEnabled,
      disabledReason: resolved.disabledReason,
      onClick: () => executeCommand(resolved.command.id),
    })),
  }));

  return <ContextMenu groups={groups} position={position} onClose={onClose} />;
};
