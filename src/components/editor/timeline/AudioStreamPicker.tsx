import React from "react";
import { useMediaJobStore } from "@/store/mediaJobStore";

export const AudioStreamPicker: React.FC = () => {
  const request = useMediaJobStore((state) => state.pickerRequest);
  const extractStream = useMediaJobStore((state) => state.extractStream);
  const closePicker = useMediaJobStore((state) => state.closePicker);
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45" onMouseDown={closePicker}>
      <div className="w-[360px] rounded-lg border border-border bg-surface-raised p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold text-foreground">Choose audio stream</div>
        <div className="space-y-2">
          {request.streams.map((stream) => (
            <button key={stream.index} type="button" className="flex w-full flex-col rounded border border-border/70 bg-surface px-3 py-2 text-left hover:bg-accent/15" onClick={() => void extractStream(request, stream.index)}>
              <span className="text-sm text-foreground">{stream.label || stream.language || `Stream ${stream.index}`}</span>
              <span className="text-xs text-muted-foreground">{stream.codec} · {stream.channelLayout || `${stream.channels || 0} channels`} · {stream.duration ? `${stream.duration.toFixed(1)}s` : "unknown duration"}</span>
            </button>
          ))}
        </div>
        <button type="button" className="mt-3 text-xs text-muted-foreground hover:text-foreground" onClick={closePicker}>Cancel</button>
      </div>
    </div>
  );
};
