import React, { useState } from "react";
import { Film, RotateCcw, RotateCw, Upload, Home, Settings } from "lucide-react";
import { Button } from "../ui/Button";
import { usePlayback } from "../../hooks/usePlayback";
import { useProjectStore } from "../../store/projectStore";
import { useUIStore } from "../../store/uiStore";

interface TopBarProps {
  onExport?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onExport }) => {
  const { currentTime, duration, formatTime } = usePlayback();
  const { project, updateProject, closeProject } = useProjectStore();
  const { toggleSettingsModal } = useUIStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [projectName, setProjectName] = useState(project?.name || "");

  const handleNameBlur = () => {
    if (projectName.trim() && projectName !== project?.name) {
      updateProject({ name: projectName });
    } else {
      setProjectName(project?.name || "");
    }
    setIsEditingName(false);
  };

  return (
    <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={closeProject} title="Back to Home">
          <Home className="w-4 h-4" />
        </Button>
        <div className="w-px h-6 bg-border" />
        <Film className="w-5 h-5 text-accent" />
        {isEditingName ? (
          <input autoFocus type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} onBlur={handleNameBlur} onKeyPress={(e) => e.key === "Enter" && handleNameBlur()} className="bg-surface-raised border border-accent rounded px-2 py-1 text-sm text-text-primary focus:outline-none" />
        ) : (
          <button onClick={() => setIsEditingName(true)} className="text-sm font-medium text-text-primary hover:text-accent transition-colors">
            {project?.name}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-text-primary">
        <span>{formatTime(currentTime)}</span>
        <span className="text-text-muted">/</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" title="Undo">
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Redo">
          <RotateCw className="w-4 h-4" />
        </Button>
        <div className="w-px h-6 bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings">
          <Settings className="w-4 h-4" />
        </Button>
        <Button variant="default" size="sm" onClick={onExport}>
          <Upload className="w-4 h-4" />
          Export
        </Button>
      </div>
    </div>
  );
};
