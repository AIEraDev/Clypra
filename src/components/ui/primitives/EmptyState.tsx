import React from "react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 px-4 text-center">
      <Icon className="w-12 h-12 text-text-muted" />
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-sm text-text-muted mt-1">{description}</p>}
      </div>
      {action && (
        <button onClick={action.onClick} className="mt-2 px-4 py-2 bg-accent text-white rounded hover:opacity-90 transition-colors">
          {action.label}
        </button>
      )}
    </div>
  );
};
