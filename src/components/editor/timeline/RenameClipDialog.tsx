import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EditingActions } from "@/core/interactions";
import { getClipDisplayName } from "@/lib/timeline/clipName";
import { toast } from "@/lib/toast";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";

interface RenameClipDialogProps {
  clipId: string | null;
  onClose: () => void;
}

export const RenameClipDialog: React.FC<RenameClipDialogProps> = ({ clipId, onClose }) => {
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId) ?? null);
  const mediaAssets = useProjectStore((state) => state.mediaAssets);
  const [name, setName] = useState("");

  useEffect(() => {
    if (clip) setName(getClipDisplayName(clip, mediaAssets));
  }, [clip, mediaAssets]);

  const handleRename = () => {
    if (!clip) return;
    const result = EditingActions.renameClip(clip.id, name);
    if (!result.success) {
      toast.error(result.error || "Unable to rename clip");
      return;
    }

    toast.success(`Renamed clip to “${result.name}”`);
    onClose();
  };

  return (
    <Modal isOpen={!!clip} onClose={onClose} title="Rename Clip">
      <div className="p-5 space-y-4">
        <div>
          <label htmlFor="rename-clip-input" className="block mb-1.5 text-xs font-medium text-text-muted">
            Clip name
          </label>
          <input
            id="rename-clip-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleRename();
            }}
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            placeholder="Clip name"
          />
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="default" onClick={handleRename} disabled={!name.trim()}>Rename</Button>
        </div>
      </div>
    </Modal>
  );
};
