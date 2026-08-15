/**
 * Audio Engine — Clypra Core
 *
 * Professional NLE sample-accurate multi-track audio playback engine.
 * Slaved strictly to Web Audio hardware clock (AudioContext.currentTime).
 *
 * Key Architectural Guarantees:
 * 1. Single-use AudioBufferSourceNode lifecycle management (zero memory leaks).
 * 2. Instant atomic voice flushing on seek/scrub/pause (zero overlapping explosions / clipping).
 * 3. 3ms anti-click micro-fade envelopes on voice spawn and release (zero DC offset pops).
 * 4. Per-voice DSP chains: 3-band EQ, Stereo Pan, Dynamics Compression, and Fade curves.
 * 5. AudioBufferPool integration for zero IPC playback latency.
 */

import type { Clip, Track } from "@/types";
import { AudioBufferPool } from "./AudioBufferPool";
import { AudioFXNodeChain } from "./AudioFXNodeChain";

export interface ActiveVoice {
  clipId: string;
  sourceNode: AudioBufferSourceNode;
  fxChain: AudioFXNodeChain;
  scheduledAtAudioTime: number;
  timelineStartSec: number;
  durationSec: number;
}

export interface AudioEngineOptions {
  audioContext?: AudioContext;
  bufferPool?: AudioBufferPool;
  maxMemoryBytes?: number;
}

export class AudioEngine {
  public readonly ctx: AudioContext;
  public readonly bufferPool: AudioBufferPool;

  private masterGain: GainNode;
  private masterLimiter: DynamicsCompressorNode;
  private activeVoices = new Map<string, ActiveVoice>();

  private _isMuted = false;
  private _masterVolume = 1.0; // 0.0 to 1.0
  private _playbackSpeed = 1.0;
  private _isDisposed = false;

  constructor(options: AudioEngineOptions = {}) {
    if (options.audioContext) {
      this.ctx = options.audioContext;
    } else {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: "interactive" });
    }

    this.bufferPool = options.bufferPool ?? new AudioBufferPool(options.maxMemoryBytes, this.ctx);
    this.bufferPool.setAudioContext(this.ctx);

    // Master DSP Graph: MasterGain -> MasterLimiter -> Destination
    this.masterGain = this.ctx.createGain();
    this.masterLimiter = this.ctx.createDynamicsCompressor();

    // Transparent safety limiter to catch accidental summing over 0dBFS
    this.masterLimiter.threshold.setValueAtTime(-0.5, this.ctx.currentTime);
    this.masterLimiter.knee.setValueAtTime(0.0, this.ctx.currentTime);
    this.masterLimiter.ratio.setValueAtTime(20.0, this.ctx.currentTime);
    this.masterLimiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
    this.masterLimiter.release.setValueAtTime(0.05, this.ctx.currentTime);

    this.masterGain.connect(this.masterLimiter);
    this.masterLimiter.connect(this.ctx.destination);
  }

  /**
   * Unlock AudioContext from user gesture handler.
   */
  public async resume(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /**
   * Reconciles audio playback for the active playhead time.
   * Called on every RAF tick or transport update during playback.
   */
  public syncPlayback(
    clips: Clip[],
    tracks: Track[],
    timelineTime: number,
    isPlaying: boolean,
    speed: number = 1.0,
    volume: number = 100,
    muted: boolean = false,
  ): void {
    if (this._isDisposed) return;

    this._isMuted = muted;
    this._masterVolume = Math.max(0, Math.min(1, volume / 100));
    this._playbackSpeed = speed;

    // Update master gain
    const now = this.ctx.currentTime;
    const targetGain = this._isMuted ? 0.0001 : Math.max(0.0001, this._masterVolume);
    this.masterGain.gain.setTargetAtTime(targetGain, now, 0.01);

    if (!isPlaying || this.ctx.state !== "running") {
      this.stopAllVoices(true);
      return;
    }

    const activeClipIds = new Set<string>();
    const trackMap = new Map<string, Track>(tracks.map((t) => [t.id, t]));

    for (const clip of clips) {
      const track = trackMap.get(clip.trackId);
      const isTrackMuted = track?.muted ?? false;
      const isTrackLocked = track?.locked ?? false;

      const clipEnd = clip.startTime + clip.duration;
      const isWithinWindow = timelineTime >= clip.startTime && timelineTime < clipEnd;

      if (isWithinWindow && !isTrackMuted && !isTrackLocked) {
        activeClipIds.add(clip.id);

        if (!this.activeVoices.has(clip.id)) {
          this.spawnVoice(clip, track, timelineTime);
        }
      }
    }

    // Terminate voices that are no longer within their active timeline window
    for (const [clipId, voice] of this.activeVoices.entries()) {
      if (!activeClipIds.has(clipId)) {
        this.killVoice(clipId, voice, true);
      }
    }
  }

  /**
   * Spawns a sample-accurate voice for a timeline clip.
   */
  private spawnVoice(clip: Clip, track: Track | undefined, timelineTime: number): void {
    const audioKey = clip.mediaId || clip.audioPath || clip.id;
    const buffer = this.bufferPool.get(audioKey);

    if (!buffer) {
      // Buffer not pre-decoded yet in memory.
      // If source path exists, load asynchronously so subsequent ticks pick it up
      const sourceUrl = clip.audioPath || clip.mediaId;
      if (sourceUrl && (sourceUrl.startsWith("http") || sourceUrl.startsWith("blob:") || sourceUrl.startsWith("asset:"))) {
        this.bufferPool.load(audioKey, sourceUrl).catch(() => {
          // Log or handle load error gracefully
        });
      }
      return;
    }

    const timeIntoClip = timelineTime - clip.startTime;
    const trimIn = clip.trimIn ?? 0;
    const bufferOffset = trimIn + timeIntoClip;
    const remainingTimelineDuration = clip.duration - timeIntoClip;

    if (remainingTimelineDuration <= 0 || bufferOffset >= buffer.duration) {
      return;
    }

    // Web Audio single-use source node
    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.playbackRate.value = this._playbackSpeed;

    // Per-voice DSP FX Chain
    const fxChain = new AudioFXNodeChain(this.ctx);
    sourceNode.connect(fxChain.inputNode);
    fxChain.outputNode.connect(this.masterGain);

    const scheduleAudioTime = this.ctx.currentTime;

    // Apply clip EQ, Pan, Volume keyframe automation, and 3ms anti-click attack micro-fade
    fxChain.applyClipConfig(
      clip,
      track?.volume ?? 1.0,
      track?.muted ?? false,
      this._masterVolume,
      this._isMuted,
      timelineTime,
      scheduleAudioTime,
      this._playbackSpeed,
    );

    // Precision hardware start
    const playDuration = remainingTimelineDuration / this._playbackSpeed;
    sourceNode.start(scheduleAudioTime, bufferOffset, playDuration);

    const voice: ActiveVoice = {
      clipId: clip.id,
      sourceNode,
      fxChain,
      scheduledAtAudioTime: scheduleAudioTime,
      timelineStartSec: clip.startTime,
      durationSec: clip.duration,
    };

    this.activeVoices.set(clip.id, voice);

    sourceNode.onended = () => {
      // Check if this ended node is still the current active voice
      const current = this.activeVoices.get(clip.id);
      if (current && current.sourceNode === sourceNode) {
        this.killVoice(clip.id, current, false);
      }
    };
  }

  /**
   * Terminates a single active voice with an anti-click release ramp.
   */
  private killVoice(clipId: string, voice: ActiveVoice, fadeOut: boolean): void {
    this.activeVoices.delete(clipId);

    if (fadeOut) {
      voice.fxChain.releaseAndDisconnect(0.003).then(() => {
        try {
          voice.sourceNode.stop();
          voice.sourceNode.disconnect();
        } catch {
          // Guard against already stopped nodes
        }
      });
    } else {
      try {
        voice.sourceNode.stop();
        voice.sourceNode.disconnect();
        voice.fxChain.releaseAndDisconnect(0);
      } catch {
        // Guard against already stopped nodes
      }
    }
  }

  /**
   * Instantly stops and cleans up all active voices.
   * Call on Seek, Scrub, Pause, and Stop.
   */
  public stopAllVoices(fadeOut: boolean = true): void {
    for (const [clipId, voice] of this.activeVoices.entries()) {
      this.killVoice(clipId, voice, fadeOut);
    }
    this.activeVoices.clear();
  }

  /**
   * Tactile audio scrub preview burst (50ms slice with micro-fade).
   * Prevents scrub audio explosions while providing responsive audio monitoring.
   */
  public playScrubBurst(clip: Clip, track: Track | undefined, sourceTime: number, burstDuration: number = 0.05): void {
    if (this.ctx.state !== "running" || this._isMuted) return;

    // Immediately cancel any running scrub voices
    this.stopAllVoices(false);

    const audioKey = clip.mediaId || clip.audioPath || clip.id;
    const buffer = this.bufferPool.get(audioKey);
    if (!buffer || sourceTime < 0 || sourceTime >= buffer.duration) return;

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;

    const gainNode = this.ctx.createGain();
    sourceNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    const now = this.ctx.currentTime;
    const targetVolume = (clip.volume ?? 1.0) * (track?.volume ?? 1.0) * this._masterVolume;

    // Anti-click attack and decay envelope for transient burst
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(targetVolume, now + 0.003);
    gainNode.gain.setValueAtTime(targetVolume, now + burstDuration - 0.005);
    gainNode.gain.linearRampToValueAtTime(0.0001, now + burstDuration);

    sourceNode.start(now, sourceTime, burstDuration);
    sourceNode.stop(now + burstDuration);

    setTimeout(() => {
      try {
        sourceNode.disconnect();
        gainNode.disconnect();
      } catch {}
    }, (burstDuration + 0.02) * 1000);
  }

  public getActiveVoiceCount(): number {
    return this.activeVoices.size;
  }

  public dispose(): void {
    this._isDisposed = true;
    this.stopAllVoices(false);
    this.bufferPool.clear();

    try {
      this.masterGain.disconnect();
      this.masterLimiter.disconnect();
    } catch {}
  }
}
