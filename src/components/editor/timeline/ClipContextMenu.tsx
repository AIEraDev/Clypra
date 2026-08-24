import React from "react";
import { ContextMenu, type ContextMenuGroup } from "@/components/ui/ContextMenu";
import { useClipCommands } from "@/core/commands";

export interface ClipContextMenuProps {
  clickedClipId: string | null;
  clickedTrackId?: string | null;
  position: { x: number; y: number };
  onClose: () => void;
  onRename?: (clipId: string) => void;
}

export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({
  clickedClipId,
  clickedTrackId,
  position,
  onClose,
  onRename,
}) => {
  const { groupedCommands, executeCommand } = useClipCommands(clickedClipId, clickedTrackId);

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
        if (resolved.command.id === "clip.rename" && clickedClipId && onRename) {
          onRename(clickedClipId);
        } else {
          executeCommand(resolved.command.id);
        }
      },
    })),
  }));

  return <ContextMenu groups={groups} position={position} onClose={onClose} />;
};
