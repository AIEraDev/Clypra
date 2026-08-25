import type { Clip, Track } from "@/types";
import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import { generateId } from "@/lib/utils/id";
import { TRACK_TYPE_CONFIG } from "@/lib/timeline/trackTypeConfig";
import { getClipAudioProperties } from "@/types/audio";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  mainVideoTrackId: string | null;
  epoch: number;
}

/**
 * Detaches the embedded audio of one video clip as a normal timeline clip.
 *
 * This command deliberately does not touch media files. The generated clip
 * keeps the source media ID and receives an explicit audio path so routing can
 * treat it as audio without probing or rewriting the source asset.
 */
export class DetachAudioCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Detach Audio";
  readonly timestamp = Date.now();
  readonly undoable = true;

  private readonly sourceClip: Clip;
  private readonly targetTrackId: string;
  private readonly generatedTrack: Track | null;
  private readonly generatedTrackIndex: number;
  private readonly audioClip: Clip;

  constructor(sourceClip: Clip, sourcePath: string, tracks: Track[]) {
    this.sourceClip = { ...sourceClip };

    const reusableTrack = tracks.find((track) => track.type === "audio" && !track.locked);
    this.targetTrackId = reusableTrack?.id ?? generateId("track");
    this.generatedTrackIndex = reusableTrack ? -1 : tracks.length;
    this.generatedTrack = reusableTrack
      ? null
      : {
          id: this.targetTrackId,
          type: "audio",
          name: "Audio",
          muted: false,
          locked: false,
          visible: true,
          height: TRACK_TYPE_CONFIG.audio.height,
        };

    const detachedAudio = getClipAudioProperties({
      ...this.sourceClip,
      kind: "audio",
      audioPath: sourcePath,
      detachedFromClipId: this.sourceClip.id,
      audio: this.sourceClip.audio,
    });

    this.audioClip = {
      ...this.sourceClip,
      id: generateId("clip"),
      name: `${this.sourceClip.name || "Video"} Audio`,
      trackId: this.targetTrackId,
      kind: "audio",
      audioPath: sourcePath,
      detachedFromClipId: this.sourceClip.id,
      audio: {
        ...detachedAudio,
        origin: "detached",
        linkState: "detached",
      },
      // Audio clips do not participate in the visual compositor.
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      opacity: 1,
    };
  }

  apply(state: TimelineState): TimelineState {
    const source = state.clips.find((clip) => clip.id === this.sourceClip.id);
    if (!source || state.clips.some((clip) => clip.id === this.audioClip.id)) return state;

    const tracks = [...state.tracks];
    if (this.generatedTrack && !tracks.some((track) => track.id === this.generatedTrack!.id)) {
      tracks.splice(Math.max(0, Math.min(this.generatedTrackIndex, tracks.length)), 0, this.generatedTrack);
    }

    return {
      ...state,
      tracks,
      clips: [
        ...state.clips.map((clip) => (clip.id === this.sourceClip.id ? { ...clip, volume: 0 } : clip)),
        this.audioClip,
      ],
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RestoreDetachedAudioCommand(
      this,
      this.sourceClip,
      this.audioClip,
      this.generatedTrack?.id ?? null,
    );
  }

  static isAlreadyDetached(clip: Clip, clips: Clip[]): boolean {
    return clips.some((candidate) => candidate.detachedFromClipId === clip.id);
  }
}

class RestoreDetachedAudioCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Undo Detach Audio";
  readonly timestamp = Date.now();
  readonly undoable = true;

  constructor(
    private readonly original: DetachAudioCommand,
    private readonly sourceClip: Clip,
    private readonly audioClip: Clip,
    private readonly generatedTrackId: string | null,
  ) {}

  apply(state: TimelineState): TimelineState {
    const hasAudioClip = state.clips.some((clip) => clip.id === this.audioClip.id);
    const clips = state.clips
      .filter((clip) => clip.id !== this.audioClip.id)
      .map((clip) => (clip.id === this.sourceClip.id ? this.sourceClip : clip));
    const hasOtherClipsOnGeneratedTrack = this.generatedTrackId
      ? clips.some((clip) => clip.trackId === this.generatedTrackId)
      : true;
    const tracks = this.generatedTrackId && hasAudioClip && !hasOtherClipsOnGeneratedTrack
      ? state.tracks.filter((track) => track.id !== this.generatedTrackId)
      : state.tracks;

    return hasAudioClip
      ? { ...state, tracks, clips, epoch: state.epoch + 1 }
      : state;
  }

  invert(): Command {
    return this.original;
  }
}
