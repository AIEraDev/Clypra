import React from "react";
import { Lock, Unlock, Trash2, Clock, ShieldCheck, ShieldAlert } from "lucide-react";
import { ContextMenu, type ContextMenuGroup } from "@/components/ui/ContextMenu";
import { GapManager } from "@/lib/timeline/gapManager";
import type { Gap } from "@/types/gap";

export interface GapContextMenuProps {
  gap: Gap;
  locked?: boolean;
  position: { x: number; y: number };
  onClose: () => void;
}

export const GapContextMenu: React.FC<GapContextMenuProps> = ({
  gap,
  locked = false,
  position,
  onClose,
}) => {
  const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0s";
    const rounded = Number(seconds.toFixed(2));
    return `${rounded}s`;
  };

  const handleRemove = () => {
    GapManager.removeGap(gap.id);
    onClose();
  };

  const handleToggleProtection = () => {
    GapManager.toggleProtection(gap.id);
    onClose();
  };

  const contextMenuGroups: ContextMenuGroup[] = [
    {
      items: [
        {
          id: "gap.remove",
          label: "Delete Gap",
          icon: Trash2,
          danger: true,
          shortcut: "⌫",
          disabled: locked || gap.protected,
          disabledReason: gap.protected
            ? "Gap is protected from deletion"
            : locked
              ? "Track is locked"
              : undefined,
          onClick: handleRemove,
        },
        {
          id: "gap.toggle_protection",
          label: gap.protected ? "Unprotect Gap" : "Protect Gap",
          icon: gap.protected ? Unlock : Lock,
          disabled: locked,
          disabledReason: locked ? "Track is locked" : undefined,
          onClick: handleToggleProtection,
        },
      ],
    },
    {
      title: "Gap Info",
      items: [
        {
          id: "gap.info.duration",
          label: `Duration: ${formatDuration(gap.duration)}`,
          icon: Clock,
          disabled: true,
          onClick: () => {},
        },
        {
          id: "gap.info.type",
          label: `Type: ${gap.protected ? "Protected" : gap.type === "manual" ? "Manual" : "Auto"}`,
          icon: gap.protected ? ShieldCheck : ShieldAlert,
          disabled: true,
          onClick: () => {},
        },
      ],
    },
  ];

  return <ContextMenu groups={contextMenuGroups} position={position} onClose={onClose} />;
};
