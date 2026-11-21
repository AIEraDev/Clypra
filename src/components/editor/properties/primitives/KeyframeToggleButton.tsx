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
          ? "bg-accent-primary/20 border-accent-primary text-accent-primary shadow-[0_0_8px_var(--clypra-accent-glow)]"
          : "bg-surface-elevated border-border-default text-text-muted hover:text-text-primary hover:border-accent-primary/40"
      }`}
      title={title}
    >
      <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
        <path d="M12 2L2 12l10 10 10-10L12 2z" />
      </svg>
    </button>
  );
};
