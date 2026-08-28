/**
 * Versioned audio-clip domain model.
 *
 * The timeline still exposes the legacy audio fields on Clip for compatibility
 * with existing playback and UI code. New code should use this shape and the
 * normalization helper below while those consumers migrate.
 */

export const AUDIO_MODEL_VERSION = 1;

export type AudioClipOrigin = "embedded" | "standalone" | "detached" | "recorded" | "compound";
export type AudioLinkState = "linked" | "unlinked" | "detached";
export type AudioChannelMode = "auto" | "mono" | "stereo" | "multichannel";
export type AudioDownmixMode = "auto" | "mono" | "stereo";

export interface AudioFadeSettings {
  duration: number;
  curve: AudioFadeCurve;
}

export interface AudioChannelConfig {
  mode: AudioChannelMode;
  downmix: AudioDownmixMode;
  /** Optional source-channel to output-channel routing map. */
  channelMap?: number[];
}

export interface AudioSpeedConfig {
  /** Keep perceived pitch stable when the clip playback rate changes. */
  preservePitch: boolean;
}

export interface ClipAudioProperties {
  /** Version of this object, independent from the broader timeline schema. */
  audioModelVersion: number;
  origin: AudioClipOrigin;
  /** Linked is the default; unlinked reserves reversible J/L-cut semantics. */
  linkState: AudioLinkState;
  /** The associated video clip when audio is temporarily unlinked. */
  linkedClipId?: string;
  /** Timeline offset applied while the audio is temporarily unlinked. */
  linkOffsetSeconds?: number;
  /** Source clip retained as provenance when this is extracted/detached audio. */
  sourceClipId?: string;
  /** Static clip gain in decibels. 0 dB is unity. */
  gainDb: number;
  /** Stereo pan in the range -1 (left) to +1 (right). */
  pan: number;
  muted: boolean;
  volumeKeyframes: AudioKeyframe[];
  fadeIn: AudioFadeSettings;
  fadeOut: AudioFadeSettings;
  channelConfig: AudioChannelConfig;
  speed: AudioSpeedConfig;
  /** Optional non-destructive processing configuration. */
  effects?: AudioFXConfig;
}

export type AudioKeyframeEasing = "linear" | "exponential" | "bezier";

/** Audio automation keyframe point. */
export interface AudioKeyframe {
  id: string;
  /** Relative time within clip duration (seconds). */
  time: number;
  /** Linear gain multiplier. */
  gain: number;
  /** Optional value alias for shared evaluator */
  value?: number;
  easing?: AudioKeyframeEasing;
}

/** Easing curve types for audio fade transitions. */
export type AudioFadeCurve = "linear" | "exponential" | "logarithmic" | "s-curve";

/** Audio FX processing configuration for a clip. */
export interface AudioFXConfig {
  eq?: {
    low: number;
    mid: number;
    high: number;
  };
  noiseSuppression?: number;
  compressor?: {
    threshold: number;
    ratio: number;
  };
  pan?: number;
  ducking?: {
    enabled: boolean;
    duckingAmount: number;
    threshold: number;
  };
}

export interface LegacyAudioClipFields {
  kind?: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
  volumeKeyframes?: AudioKeyframe[];
  audioFX?: AudioFXConfig;
  audioPath?: string;
  detachedFromClipId?: string;
  audio?: Partial<ClipAudioProperties>;
}

export function linearGainToDb(value: number): number {
  // Keep the persisted representation JSON-safe. `muted` carries the exact
  // semantic state; -96 dB is the practical silence floor for a stored gain.
  if (!Number.isFinite(value) || value <= 0) return -96;
  return 20 * Math.log10(value);
}

export function dbToLinearGain(value: number): number {
  if (!Number.isFinite(value)) return value === -Infinity ? 0 : 1;
  return Math.pow(10, value / 20);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function inferAudioOrigin(fields: LegacyAudioClipFields): AudioClipOrigin {
  if (fields.detachedFromClipId) return "detached";
  if (fields.audio?.origin) return fields.audio.origin;
  if (fields.kind === "audio") return "standalone";
  return "embedded";
}

/**
 * Converts both the new model and legacy top-level fields into a complete,
 * immutable-by-convention audio property object.
 */
export function normalizeClipAudioProperties(fields: LegacyAudioClipFields): ClipAudioProperties {
  const legacyVolume = fields.volume ?? 1;
  const supplied = fields.audio;
  const fadeIn = supplied?.fadeIn ?? {
    duration: Math.max(0, fields.fadeIn ?? 0),
    curve: fields.fadeInCurve ?? "linear",
  };
  const fadeOut = supplied?.fadeOut ?? {
    duration: Math.max(0, fields.fadeOut ?? 0),
    curve: fields.fadeOutCurve ?? "linear",
  };

  return {
    audioModelVersion: AUDIO_MODEL_VERSION,
    origin: supplied?.origin ?? inferAudioOrigin(fields),
    linkState: supplied?.linkState ?? (fields.detachedFromClipId ? "detached" : "linked"),
    linkedClipId: supplied?.linkedClipId,
    linkOffsetSeconds: supplied?.linkOffsetSeconds,
    sourceClipId: supplied?.sourceClipId ?? fields.detachedFromClipId,
    gainDb: supplied?.gainDb ?? linearGainToDb(legacyVolume),
    pan: clamp(supplied?.pan ?? fields.audioFX?.pan ?? 0, -1, 1),
    muted: supplied?.muted ?? legacyVolume <= 0,
    volumeKeyframes: [...(supplied?.volumeKeyframes ?? fields.volumeKeyframes ?? [])].sort((a, b) => a.time - b.time),
    fadeIn: {
      duration: Math.max(0, fadeIn.duration),
      curve: fadeIn.curve ?? "linear",
    },
    fadeOut: {
      duration: Math.max(0, fadeOut.duration),
      curve: fadeOut.curve ?? "linear",
    },
    channelConfig: {
      mode: supplied?.channelConfig?.mode ?? "auto",
      downmix: supplied?.channelConfig?.downmix ?? "auto",
      channelMap: supplied?.channelConfig?.channelMap ? [...supplied.channelConfig.channelMap] : undefined,
    },
    speed: {
      preservePitch: supplied?.speed?.preservePitch ?? false,
    },
    effects: supplied?.effects ?? fields.audioFX,
  };
}

/** Returns the canonical model for a clip-shaped object. */
export function getClipAudioProperties(fields: LegacyAudioClipFields): ClipAudioProperties {
  return normalizeClipAudioProperties(fields);
}

function isAudioCapableClip(fields: LegacyAudioClipFields): boolean {
  return fields.kind === "audio" || fields.kind === "video" || fields.kind === "compound" || Boolean(fields.audioPath) || Boolean(fields.detachedFromClipId) || Boolean(fields.audio);
}

function mergeAudioProperties(
  current: ClipAudioProperties,
  patch: Partial<ClipAudioProperties>,
): ClipAudioProperties {
  return normalizeClipAudioProperties({
    kind: "audio",
    audio: {
      ...current,
      ...patch,
      fadeIn: { ...current.fadeIn, ...patch.fadeIn },
      fadeOut: { ...current.fadeOut, ...patch.fadeOut },
      channelConfig: { ...current.channelConfig, ...patch.channelConfig },
      speed: { ...current.speed, ...patch.speed },
    },
  });
}

/**
 * Mirrors an audio edit into the structured model while runtime consumers still
 * read the legacy top-level fields. Use it at every generic clip mutation
 * boundary so timeline controls and the Audio Property panel cannot diverge.
 */
export function synchronizeClipAudioProperties<T extends LegacyAudioClipFields>(
  clip: T,
  updates: Omit<Partial<T>, "audio"> & { audio?: Partial<ClipAudioProperties> },
): Omit<Partial<T>, "audio"> & { audio?: ClipAudioProperties } {
  if (!isAudioCapableClip({ ...clip, ...updates })) return { ...updates, audio: undefined };

  let audio = normalizeClipAudioProperties(clip);
  if (updates.audio) audio = mergeAudioProperties(audio, updates.audio);

  if (updates.volume !== undefined) {
    audio = { ...audio, gainDb: linearGainToDb(updates.volume), muted: updates.volume <= 0 };
  }
  if (updates.fadeIn !== undefined) {
    audio = { ...audio, fadeIn: { ...audio.fadeIn, duration: Math.max(0, updates.fadeIn) } };
  }
  if (updates.fadeOut !== undefined) {
    audio = { ...audio, fadeOut: { ...audio.fadeOut, duration: Math.max(0, updates.fadeOut) } };
  }
  if (updates.fadeInCurve !== undefined) {
    audio = { ...audio, fadeIn: { ...audio.fadeIn, curve: updates.fadeInCurve } };
  }
  if (updates.fadeOutCurve !== undefined) {
    audio = { ...audio, fadeOut: { ...audio.fadeOut, curve: updates.fadeOutCurve } };
  }
  if (updates.volumeKeyframes !== undefined) {
    audio = { ...audio, volumeKeyframes: [...updates.volumeKeyframes].sort((a, b) => a.time - b.time) };
  }
  if (updates.audioFX !== undefined) {
    audio = {
      ...audio,
      effects: updates.audioFX,
      pan: clamp(updates.audioFX?.pan ?? audio.pan, -1, 1),
    };
  }

  const synchronized: Omit<Partial<T>, "audio"> & { audio?: ClipAudioProperties } = { ...updates, audio };
  // A structured-only write must remain audible until every playback/export
  // consumer has migrated to ClipAudioProperties.
  if (updates.audio) {
    synchronized.volume = audio.muted ? 0 : dbToLinearGain(audio.gainDb);
    synchronized.fadeIn = audio.fadeIn.duration;
    synchronized.fadeOut = audio.fadeOut.duration;
    synchronized.fadeInCurve = audio.fadeIn.curve;
    synchronized.fadeOutCurve = audio.fadeOut.curve;
    synchronized.volumeKeyframes = audio.volumeKeyframes;
    synchronized.audioFX = { ...(audio.effects ?? {}), pan: audio.pan };
  }

  return synchronized;
}
