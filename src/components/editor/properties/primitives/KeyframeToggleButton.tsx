import React from "react";

interface KeyframeToggleButtonProps {
  active: boolean;
  onToggle: () => void;
  title?: string;
}

export const KeyframeToggleButton: React.FC<KeyframeToggleButtonProps> = ({ active, onToggle, title = "Toggle Keyframe" }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`p-1 rounded transition-all cursor-pointer select-none border ${
        active
          ? "bg-accent/20 border-accent text-accent shadow-[0_0_8px_rgba(var(--color-accent-raw),0.4)]"
          : "bg-surface-raised border-border/60 text-text-muted hover:text-text-primary hover:border-accent/40"
      }`}
      title={title}
    >
      <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
        <path d="M12 2L2 12l10 10 10-10L12 2z" />
      </svg>
    </button>
  );
};
