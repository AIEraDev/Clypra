import type { Clip, Track } from "@/types";
import { getClipAudioProperties, synchronizeClipAudioProperties } from "@/types/audio";
import type { Command } from "../Command";
import { generateCommandId } from "../Command";
import { generateId } from "@/lib/utils/id";
import { TRACK_TYPE_CONFIG } from "@/lib/timeline/trackTypeConfig";

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  epoch: number;
}

/**
 * Creates a reversible J/L-cut audio companion. Unlike detach, the companion
 * retains a link to its source video and can be re-linked without media work.
 */
export class UnlinkAudioCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Unlink Audio";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private readonly generatedTrack: Track | null;
  private readonly audioClip: Clip;
  private readonly sourceClip: Clip;

  constructor(sourceClip: Clip, sourcePath: string, tracks: Track[]) {
    this.sourceClip = { ...sourceClip };
    const reusable = tracks.find((track) => track.type === "audio" && !track.locked);
    const trackId = reusable?.id ?? generateId("track");
    this.generatedTrack = reusable ? null : {
      id: trackId, type: "audio", name: "Linked Audio", muted: false, locked: false, visible: true,
      height: TRACK_TYPE_CONFIG.audio.height,
    };
    const sourceAudio = getClipAudioProperties(sourceClip);
    this.audioClip = {
      ...sourceClip,
      id: generateId("clip"),
      name: `${sourceClip.name || "Video"} Audio`,
      trackId,
      kind: "audio",
      audioPath: sourcePath,
      x: 0, y: 0, width: 0, height: 0, opacity: 1,
      audio: {
        ...sourceAudio,
        origin: "embedded",
        linkState: "unlinked",
        linkedClipId: sourceClip.id,
        sourceClipId: sourceClip.id,
        linkOffsetSeconds: 0,
      },
    };
  }

  apply(state: TimelineState): TimelineState {
    if (!state.clips.some((clip) => clip.id === this.sourceClip.id) || state.clips.some((clip) => clip.id === this.audioClip.id)) return state;
    return {
      ...state,
      tracks: this.generatedTrack ? [...state.tracks, this.generatedTrack] : state.tracks,
      clips: [
        ...state.clips.map((clip) => clip.id === this.sourceClip.id
          ? { ...clip, ...synchronizeClipAudioProperties(clip, { volume: 0, audio: { linkState: "unlinked" } }) }
          : clip),
        this.audioClip,
      ],
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RestoreUnlinkedAudioCommand(this, this.sourceClip, this.audioClip, this.generatedTrack?.id ?? null);
  }

  static findLinkedAudio(sourceClipId: string, clips: Clip[]): Clip | undefined {
    return clips.find((clip) => clip.audio?.linkState === "unlinked" && clip.audio.linkedClipId === sourceClipId);
  }
}

class RestoreUnlinkedAudioCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Relink Audio";
  readonly timestamp = Date.now();
  readonly undoable = true;

  constructor(
    private readonly original: UnlinkAudioCommand,
    private readonly sourceClip: Clip,
    private readonly audioClip: Clip,
    private readonly generatedTrackId: string | null,
  ) {}

  apply(state: TimelineState): TimelineState {
    if (!state.clips.some((clip) => clip.id === this.audioClip.id)) return state;
    const clips = state.clips
      .filter((clip) => clip.id !== this.audioClip.id)
      .map((clip) => clip.id === this.sourceClip.id ? this.sourceClip : clip);
    const tracks = this.generatedTrackId && !clips.some((clip) => clip.trackId === this.generatedTrackId)
      ? state.tracks.filter((track) => track.id !== this.generatedTrackId)
      : state.tracks;
    return { ...state, clips, tracks, epoch: state.epoch + 1 };
  }

  invert(): Command {
    return this.original;
  }
}

/** Relinks an audio companion created by an earlier unlink command. */
export class RelinkAudioCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Relink Audio";
  readonly timestamp = Date.now();
  readonly undoable = true;
  private readonly sourceBefore: Clip;
  private readonly sourceRestored: Clip;

  constructor(private readonly sourceClip: Clip, private readonly audioClip: Clip) {
    this.sourceBefore = { ...sourceClip };
    const companionAudio = getClipAudioProperties(audioClip);
    const restored = synchronizeClipAudioProperties(sourceClip, {
      volume: companionAudio.muted ? 0 : Math.pow(10, companionAudio.gainDb / 20),
      audio: {
        ...companionAudio,
        linkState: "linked",
        linkedClipId: undefined,
        linkOffsetSeconds: undefined,
      },
    });
    this.sourceRestored = { ...sourceClip, ...restored } as Clip;
  }

  apply(state: TimelineState): TimelineState {
    if (!state.clips.some((clip) => clip.id === this.audioClip.id)) return state;
    return {
      ...state,
      clips: state.clips
        .filter((clip) => clip.id !== this.audioClip.id)
        .map((clip) => clip.id === this.sourceClip.id ? this.sourceRestored : clip),
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return new RestoreRelinkAudioCommand(this, this.sourceBefore, this.audioClip);
  }
}

class RestoreRelinkAudioCommand implements Command {
  readonly id = generateCommandId();
  readonly label = "Undo Relink Audio";
  readonly timestamp = Date.now();
  readonly undoable = true;

  constructor(private readonly original: RelinkAudioCommand, private readonly sourceBefore: Clip, private readonly audioClip: Clip) {}

  apply(state: TimelineState): TimelineState {
    if (state.clips.some((clip) => clip.id === this.audioClip.id)) return state;
    return {
      ...state,
      clips: [...state.clips.map((clip) => clip.id === this.sourceBefore.id ? this.sourceBefore : clip), this.audioClip],
      epoch: state.epoch + 1,
    };
  }

  invert(): Command {
    return this.original;
  }
}
