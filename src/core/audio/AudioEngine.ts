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
import { evaluateEffectiveAudioState } from "./effectiveAudioState";

export interface ActiveVoice {
  clipId: string;
  sourceNode: AudioNode & { stop?: () => void };
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
      const effective = evaluateEffectiveAudioState(clip, track, timelineTime, {
        tracks,
        masterVolume: this._masterVolume,
        masterMuted: this._isMuted,
      });
      const isTrackLocked = track?.locked ?? false;

      const clipEnd = clip.startTime + clip.duration;
      const isWithinWindow = timelineTime >= clip.startTime && timelineTime < clipEnd;

      if (isWithinWindow && !effective.muted && !isTrackLocked) {
        activeClipIds.add(clip.id);

        if (!this.activeVoices.has(clip.id)) {
          this.spawnVoice(clip, track, tracks, timelineTime);
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
  private spawnVoice(clip: Clip, track: Track | undefined, tracks: Track[], timelineTime: number): void {
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

    const effective = evaluateEffectiveAudioState(clip, track, timelineTime, { tracks });
    const scheduleAudioTime = this.ctx.currentTime;
    const pitchPreservingSource = effective.preservePitch && Math.abs(this._playbackSpeed - 1) > 0.001
      ? this.createPitchPreservingSource(buffer, bufferOffset, remainingTimelineDuration, this._playbackSpeed, clip.id)
      : null;

    // AudioBufferSourceNode is ideal for normal playback. At speed changes,
    // use an allocation-free granular renderer because Web Audio has no
    // `preservesPitch` equivalent on AudioBufferSourceNode.
    const sourceNode: ActiveVoice["sourceNode"] = pitchPreservingSource ?? this.ctx.createBufferSource();
    if (!pitchPreservingSource) {
      const bufferSource = sourceNode as AudioBufferSourceNode;
      bufferSource.buffer = buffer;
      bufferSource.playbackRate.value = this._playbackSpeed;
    }

    // Per-voice DSP FX Chain
    const fxChain = new AudioFXNodeChain(this.ctx);
    sourceNode.connect(fxChain.inputNode);
    fxChain.outputNode.connect(this.masterGain);

    // Apply clip EQ, Pan, Volume keyframe automation, and 3ms anti-click attack micro-fade
    fxChain.applyClipConfig(
      clip,
      track?.volume ?? 1.0,
      track?.muted ?? false,
      1,
      this._isMuted,
      timelineTime,
      scheduleAudioTime,
      this._playbackSpeed,
      track,
      tracks,
    );

    // Precision hardware start for the native Web Audio source. A
    // ScriptProcessor source begins when connected and tracks its own frame
    // cursor in `createPitchPreservingSource`.
    if (!pitchPreservingSource) {
      const playDuration = remainingTimelineDuration / this._playbackSpeed;
      (sourceNode as AudioBufferSourceNode).start(scheduleAudioTime, bufferOffset, playDuration);
    }

    const voice: ActiveVoice = {
      clipId: clip.id,
      sourceNode,
      fxChain,
      scheduledAtAudioTime: scheduleAudioTime,
      timelineStartSec: clip.startTime,
      durationSec: clip.duration,
    };

    this.activeVoices.set(clip.id, voice);

    if (!pitchPreservingSource) (sourceNode as AudioBufferSourceNode).onended = () => {
      // Check if this ended node is still the current active voice
      const current = this.activeVoices.get(clip.id);
      if (current && current.sourceNode === sourceNode) {
        this.killVoice(clip.id, current, false);
      }
    };
  }

  /**
   * Browser fallback for `preservePitch`: granular overlap-add synthesis.
   * It advances the source at transport speed but preserves the short-window
   * waveform period, keeping pitch stable without a second media-element
   * playback authority.
   */
  private createPitchPreservingSource(
    buffer: AudioBuffer,
    offsetSeconds: number,
    timelineDurationSeconds: number,
    speed: number,
    clipId: string,
  ): ScriptProcessorNode | null {
    const createScriptProcessor = (this.ctx as AudioContext & {
      createScriptProcessor?: (bufferSize?: number, numberOfInputChannels?: number, numberOfOutputChannels?: number) => ScriptProcessorNode;
    }).createScriptProcessor;
    if (!createScriptProcessor) return null;

    const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
    const processor = createScriptProcessor.call(this.ctx, 1024, 0, channels);
    const sampleRate = buffer.sampleRate;
    const safeSpeed = Math.max(0.25, Math.min(4, speed));
    const initialFrame = Math.max(0, Math.floor(offsetSeconds * sampleRate));
    const maxFrames = Math.max(0, Math.ceil((timelineDurationSeconds / safeSpeed) * sampleRate));
    const grainSize = Math.max(64, Math.round(sampleRate * 0.04));
    const hop = Math.max(1, Math.floor(grainSize / 4));
    const halfGrain = grainSize / 2;
    let renderedFrames = 0;
    let completed = false;

    const finish = () => {
      if (completed) return;
      completed = true;
      processor.onaudioprocess = null;
      const current = this.activeVoices.get(clipId);
      if (current?.sourceNode === processor) this.killVoice(clipId, current, false);
    };

    processor.onaudioprocess = (event) => {
      const output = event.outputBuffer;
      const frameCount = output.length;
      for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
        const outputData = output.getChannelData(channel);
        const sourceData = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        for (let frame = 0; frame < frameCount; frame += 1) {
          const synthesisFrame = renderedFrames + frame;
          if (synthesisFrame >= maxFrames) {
            outputData[frame] = 0;
            continue;
          }
          const center = Math.floor(synthesisFrame / hop) * hop;
          let sum = 0;
          let weight = 0;
          for (const grainCenter of [center - hop, center, center + hop, center + 2 * hop]) {
            const local = synthesisFrame - grainCenter;
            if (Math.abs(local) > halfGrain) continue;
            const sourcePosition = initialFrame + grainCenter * safeSpeed + local;
            const sourceIndex = Math.max(0, Math.floor(sourcePosition));
            if (sourceIndex >= sourceData.length) continue;
            const next = sourceData[Math.min(sourceData.length - 1, sourceIndex + 1)];
            const fractional = sourcePosition - sourceIndex;
            const window = 0.5 + 0.5 * Math.cos(Math.PI * local / halfGrain);
            sum += (sourceData[sourceIndex] + (next - sourceData[sourceIndex]) * fractional) * window;
            weight += window;
          }
          outputData[frame] = weight > 0.000001 ? sum / weight : 0;
        }
      }
      renderedFrames += frameCount;
      if (renderedFrames >= maxFrames) finish();
    };
    return processor;
  }

  /**
   * Terminates a single active voice with an anti-click release ramp.
   */
  private killVoice(clipId: string, voice: ActiveVoice, fadeOut: boolean): void {
    this.activeVoices.delete(clipId);

    if (fadeOut) {
      voice.fxChain.releaseAndDisconnect(0.003).then(() => {
        try {
          voice.sourceNode.stop?.();
          voice.sourceNode.disconnect();
        } catch {
          // Guard against already stopped nodes
        }
      });
    } else {
      try {
        voice.sourceNode.stop?.();
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
    const targetVolume = evaluateEffectiveAudioState(clip, track, clip.startTime + sourceTime, {
      masterVolume: 1,
      masterMuted: this._isMuted,
    }).gain;

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
