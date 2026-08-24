import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  id?: string;
  label: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  shortcut?: string;
  divider?: boolean;
}

export interface ContextMenuGroup {
  title?: string;
  items: ContextMenuItem[];
}

export interface ContextMenuProps {
  items?: ContextMenuItem[];
  groups?: ContextMenuGroup[];
  position: { x: number; y: number };
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  groups,
  position,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
    visibility: "hidden" | "visible";
  }>({
    left: position.x,
    top: position.y,
    visibility: "hidden", // Hidden on initial mount until layout effect calculates exact flip/bounds
  });

  // Dynamic viewport collision and flip placement
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 12;

    let left = position.x;
    let top = position.y;

    const spaceBelow = viewportHeight - position.y - padding;
    const spaceAbove = position.y - padding;

    // Vertical placement:
    // If it fits below cursor, place below
    // Else if it fits above cursor, flip upwards so the menu fits on top of the clip
    // Else choose the side with more space and constrain with scrollbar
    let maxHeight: number | undefined = undefined;

    if (rect.height <= spaceBelow) {
      top = position.y;
    } else if (rect.height <= spaceAbove) {
      top = position.y - rect.height;
    } else {
      if (spaceAbove >= spaceBelow) {
        maxHeight = Math.max(120, spaceAbove);
        top = Math.max(padding, position.y - maxHeight);
      } else {
        maxHeight = Math.max(120, spaceBelow);
        top = position.y;
      }
    }

    // Horizontal placement:
    const spaceRight = viewportWidth - position.x - padding;
    const spaceLeft = position.x - padding;

    if (rect.width <= spaceRight) {
      left = position.x;
    } else if (rect.width <= spaceLeft) {
      left = position.x - rect.width;
    } else {
      left = Math.max(padding, Math.min(position.x, viewportWidth - rect.width - padding));
    }

    // Hard bounds clamping to prevent any pixel bleeding off-screen
    const effectiveHeight = maxHeight ?? rect.height;
    left = Math.max(padding, Math.min(left, Math.max(padding, viewportWidth - rect.width - padding)));
    top = Math.max(padding, Math.min(top, Math.max(padding, viewportHeight - effectiveHeight - padding)));

    setMenuStyle({
      left,
      top,
      maxHeight,
      visibility: "visible",
    });
  }, [position, items, groups]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = () => onClose();

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleClick);

    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
    };
  }, [onClose]);

  const renderItem = (item: ContextMenuItem, idx: number) => {
    const Icon = item.icon;
    const isDisabled = item.disabled;

    return (
      <React.Fragment key={item.id || idx}>
        {item.divider && <div className="my-1 border-t border-white/10" />}
        <button
          type="button"
          disabled={isDisabled}
          title={item.disabledReason || (isDisabled ? "Unavailable" : undefined)}
          onClick={(e) => {
            e.stopPropagation();
            if (isDisabled) return;
            item.onClick();
            onClose();
          }}
          className={`w-full px-3 py-1.5 text-left flex items-center justify-between text-xs rounded transition-colors cursor-pointer select-none ${
            isDisabled
              ? "opacity-40 cursor-not-allowed hover:bg-transparent text-text-muted"
              : item.danger
                ? "text-rose-400 hover:bg-rose-500/15 hover:text-rose-300"
                : "text-text-primary hover:bg-surface-raised hover:text-white"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 pr-2">
            {Icon && (
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${
                  isDisabled
                    ? "text-text-muted"
                    : item.danger
                      ? "text-rose-400"
                      : "text-text-muted group-hover:text-text-primary"
                }`}
              />
            )}
            <span className="truncate font-medium">{item.label}</span>
          </div>

          {item.shortcut && (
            <span
              className={`text-[10px] tracking-wider shrink-0 font-mono ml-auto pl-3 ${
                isDisabled ? "text-text-muted/40" : "text-text-muted/75"
              }`}
            >
              {item.shortcut}
            </span>
          )}
        </button>
      </React.Fragment>
    );
  };

  // Standardize items or groups
  const renderedGroups: ContextMenuGroup[] = groups
    ? groups
    : items
      ? [{ items }]
      : [];

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="context-menu"
      className="fixed z-[1000] bg-surface-floating/95 backdrop-blur-md border border-border/80 rounded-lg shadow-2xl min-w-52 max-w-72 py-1 px-1 text-xs animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/40 overflow-y-auto scrollbar-thin"
      style={{
        left: `${menuStyle.left}px`,
        top: `${menuStyle.top}px`,
        maxHeight: menuStyle.maxHeight ? `${menuStyle.maxHeight}px` : undefined,
        visibility: menuStyle.visibility,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {renderedGroups.map((grp, gIdx) => (
        <div key={gIdx} className={gIdx > 0 ? "pt-1 mt-1 border-t border-white/8" : ""}>
          {grp.title && (
            <div className="px-3 py-0.5 text-[10px] font-semibold text-text-muted/60 uppercase tracking-wider">
              {grp.title}
            </div>
          )}
          {grp.items.map((item, itemIdx) => renderItem(item, itemIdx))}
        </div>
      ))}
    </div>
  );
};
