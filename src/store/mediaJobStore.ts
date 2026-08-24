import { create } from "zustand";
import type { MediaAsset, MediaStreamInfo } from "@/types";
import {
  cancelMediaJob,
  listenForMediaJobUpdates,
  probeMediaStreams,
  startAudioExtraction,
  type MediaJobUpdate,
} from "@/lib/platform/tauri";
import { useProjectStore } from "./projectStore";
import { toast } from "@/lib/toast";

export interface MediaJob {
  id: string;
  operation: "audioExtraction";
  state: MediaJobUpdate["state"];
  progress: number;
  errorSummary?: string;
  resultingAssetId?: string;
}

interface StreamPickerRequest {
  sourceAssetId: string;
  sourcePath: string;
  streams: MediaStreamInfo[];
}

interface MediaJobStore {
  jobs: Record<string, MediaJob>;
  pickerRequest: StreamPickerRequest | null;
  startListening: () => void;
  prepareExtraction: (asset: MediaAsset) => Promise<void>;
  extractStream: (request: StreamPickerRequest, streamIndex: number) => Promise<void>;
  closePicker: () => void;
  cancel: (jobId: string) => Promise<void>;
}

let unlisten: (() => void) | null = null;

export const useMediaJobStore = create<MediaJobStore>((set, get) => ({
  jobs: {},
  pickerRequest: null,

  startListening: () => {
    if (unlisten) return;
    void listenForMediaJobUpdates((update) => {
      set((state) => ({
        jobs: {
          ...state.jobs,
          [update.jobId]: {
            id: update.jobId,
            operation: "audioExtraction",
            state: update.state,
            progress: update.progress ?? state.jobs[update.jobId]?.progress ?? 0,
            errorSummary: update.errorSummary,
            resultingAssetId: update.resultingAssetId,
          },
        },
      }));
      if (update.state === "completed") {
        // The result is fetched lazily by the job completion handler so the
        // editor receives the derived asset without inserting a timeline clip.
        import("@/lib/platform/tauri").then(({ getMediaJobResult }) => getMediaJobResult(update.jobId)).then((result) => {
          const asset = result?.asset;
          if (!asset) return;
          const mediaAsset: MediaAsset = {
            id: asset.id,
            name: asset.name,
            path: asset.path,
            type: "audio",
            duration: asset.duration,
            size: asset.size,
            streams: asset.streams,
            derivedFrom: {
              sourceAssetId: asset.sourceAssetId,
              sourceStreamIndex: asset.sourceStreamIndex,
              extractionMethod: asset.extractionMethod,
              operationFingerprint: asset.operationFingerprint,
            },
          };
          useProjectStore.getState().addMediaAsset(mediaAsset);
          toast.success("Audio extraction complete");
        }).catch((error) => console.warn("[MediaJobStore] Failed to register extracted asset", error));
      } else if (update.state === "failed") {
        toast.error(update.errorSummary || "Audio extraction failed");
      } else if (update.state === "cancelled") {
        toast.info("Audio extraction cancelled");
      }
    }).then((stop) => { unlisten = stop; }).catch((error) => console.warn("[MediaJobStore] Listener unavailable", error));
  },

  prepareExtraction: async (asset) => {
    get().startListening();
    const allStreams = asset.streams ?? (await probeMediaStreams(asset.path));
    const audioStreams = allStreams.filter((stream) => stream.type === "audio");
    if (!asset.streams?.length) useProjectStore.getState().updateMediaAsset(asset.id, { streams: allStreams });
    if (audioStreams.length === 0) {
      toast.error("This media has no audio stream");
      return;
    }
    const request = { sourceAssetId: asset.id, sourcePath: asset.path, streams: audioStreams };
    if (audioStreams.length === 1) {
      await get().extractStream(request, audioStreams[0].index);
    } else {
      set({ pickerRequest: request });
    }
  },

  extractStream: async (request, streamIndex) => {
    get().startListening();
    const jobId = await startAudioExtraction({ sourceAssetId: request.sourceAssetId, sourcePath: request.sourcePath, sourceStreamIndex: streamIndex, mode: "auto" });
    set((state) => ({ pickerRequest: null, jobs: { ...state.jobs, [jobId]: { id: jobId, operation: "audioExtraction", state: "queued", progress: 0 } } }));
  },

  closePicker: () => set({ pickerRequest: null }),
  cancel: async (jobId) => { await cancelMediaJob(jobId); },
}));
