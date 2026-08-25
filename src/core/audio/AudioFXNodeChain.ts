/**
 * Audio FX Node Chain — Clypra Core
 *
 * Parametric DSP processing chain per active audio voice.
 * Encapsulates EQ, stereo panning, dynamics compression, volume automation keyframes,
 * and anti-click fade-in/fade-out curves.
 */

import type { AudioFadeCurve, AudioKeyframe, Clip, Track } from "@/types";
import { evaluateAudioKeyframes, evaluateEffectiveAudioState, evaluateFadeCurve } from "./effectiveAudioState";

export class AudioFXNodeChain {
  public readonly inputNode: AudioNode;
  public readonly outputNode: AudioNode;

  private ctx: AudioContext;
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private pannerNode: StereoPannerNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private gainNode: GainNode;
  private routingInput: GainNode;
  private channelRoutingNodes: AudioNode[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.routingInput = ctx.createGain();

    // 1. 3-Band Parametric EQ
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 120; // 120 Hz boundary

    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1000; // 1 kHz center
    this.eqMid.Q.value = 1.0;

    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 4500; // 4.5 kHz boundary

    // 2. Gain Node (Volume & Fade Automation)
    this.gainNode = ctx.createGain();

    // 3. Stereo Panner (if supported in browser/webview)
    if (typeof ctx.createStereoPanner === "function") {
      this.pannerNode = ctx.createStereoPanner();
    }

    // AU-3 fix: always create and wire compressorNode into the chain so clip-level
    // compression settings take effect. Previously it was created on demand in
    // applyClipConfig but never connected — audio never passed through it.
    // Default params (threshold=0, ratio=1) are transparent/passthrough.
    this.compressorNode = ctx.createDynamicsCompressor();
    if (this.compressorNode.threshold) this.compressorNode.threshold.value = 0;   // 0dBFS = never triggers
    if (this.compressorNode.knee) this.compressorNode.knee.value = 0;
    if (this.compressorNode.ratio) this.compressorNode.ratio.value = 1;       // 1:1 = unity gain / transparent
    if (this.compressorNode.attack) this.compressorNode.attack.value = 0.003;
    if (this.compressorNode.release) this.compressorNode.release.value = 0.25;

    // Connect chain:
    // input → channel router → EQ → [panner] → gain → compressor (output)
    this.inputNode = this.routingInput;
    this.routingInput.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);

    if (this.pannerNode) {
      this.eqHigh.connect(this.pannerNode);
      this.pannerNode.connect(this.gainNode);
    } else {
      this.eqHigh.connect(this.gainNode);
    }

    this.gainNode.connect(this.compressorNode);
    this.outputNode = this.compressorNode;
  }

  /**
   * Apply clip configuration and automate volume/fade envelopes.
   */
  public applyClipConfig(
    clip: Clip,
    trackVolume: number = 1.0,
    trackMuted: boolean = false,
    masterVolume: number = 1.0,
    masterMuted: boolean = false,
    timelinePlayheadSecs: number = 0,
    scheduleAudioStartTime: number = 0,
    playbackSpeed: number = 1.0,
    track?: Track,
    tracks?: Track[],
  ): void {
    const now = scheduleAudioStartTime || this.ctx.currentTime;
    const timeIntoClip = Math.max(0, timelinePlayheadSecs - clip.startTime);
    const effective = evaluateEffectiveAudioState(clip, track ?? {
      id: clip.trackId,
      type: "audio",
      name: "Audio",
      muted: trackMuted,
      locked: false,
      visible: true,
      height: 0,
      volume: trackVolume,
    }, timelinePlayheadSecs, { tracks, masterVolume, masterMuted });
    const isMuted = effective.muted;

    this.configureChannelRouting(effective.channelConfig);

    // 1. Configure EQ
    const fx = effective.effects;
    if (fx?.eq) {
      this.eqLow.gain.setValueAtTime(fx.eq.low ?? 0, now);
      this.eqMid.gain.setValueAtTime(fx.eq.mid ?? 0, now);
      this.eqHigh.gain.setValueAtTime(fx.eq.high ?? 0, now);
    } else {
      this.eqLow.gain.setValueAtTime(0, now);
      this.eqMid.gain.setValueAtTime(0, now);
      this.eqHigh.gain.setValueAtTime(0, now);
    }

    // 2. Configure Panner
    if (this.pannerNode) {
      this.pannerNode.pan.setValueAtTime(effective.pan, now);
    }

    // 3. Configure Compressor (AU-3 fix: always-connected, configure or reset to passthrough)
    if (fx?.compressor) {
      this.compressorNode!.threshold.setValueAtTime(fx.compressor.threshold ?? -24, now);
      this.compressorNode!.ratio.setValueAtTime(fx.compressor.ratio ?? 4, now);
      this.compressorNode!.knee.setValueAtTime(3, now);
      this.compressorNode!.attack.setValueAtTime(0.003, now);
      this.compressorNode!.release.setValueAtTime(0.25, now);
    } else {
      // Reset to transparent passthrough: 0dBFS threshold, 1:1 ratio → no compression
      this.compressorNode!.threshold.setValueAtTime(0, now);
      this.compressorNode!.ratio.setValueAtTime(1, now);
    }

    // 4. Configure Volume & Automation Envelopes
    this.gainNode.gain.cancelScheduledValues(now);

    const hasKeyframes = effective.keyframes.length > 0;
    const sortedKeyframes = hasKeyframes
      ? [...effective.keyframes].sort((a, b) => a.time - b.time)
      : [];

    const effectiveClipMultiplier = effective.staticGain;
    // AU-4 fix: pass presorted=true so evaluateKeyframes skips its internal O(n log n) sort —
    // sortedKeyframes is already ordered above.
    const startKeyframeGain = hasKeyframes
      ? evaluateAudioKeyframes(sortedKeyframes, timeIntoClip, 1.0, true)
      : 1.0;

    const startTargetVolume = isMuted
      ? 0.0001
      : Math.max(0.0001, Math.min(2.0, startKeyframeGain * effectiveClipMultiplier));

    // Initial 3ms anti-click attack micro-fade
    this.gainNode.gain.setValueAtTime(0.0001, now);
    this.gainNode.gain.linearRampToValueAtTime(startTargetVolume, now + 0.003);

    // 5. Schedule remaining future keyframes slaved to AudioContext clock
    if (hasKeyframes && !isMuted) {
      let prevAudioTime = now + 0.003;
      let prevGain = startTargetVolume;

      for (const kf of sortedKeyframes) {
        if (kf.time > timeIntoClip) {
          const deltaSec = (kf.time - timeIntoClip) / Math.max(0.01, playbackSpeed);
          const targetAudioTime = now + deltaSec;
          const targetGain = Math.max(
            0.0001,
            Math.min(2.0, kf.gain * effectiveClipMultiplier)
          );

          if (targetAudioTime > prevAudioTime) {
            const easing = kf.easing || "linear";
            if (easing === "exponential") {
              this.gainNode.gain.exponentialRampToValueAtTime(targetGain, targetAudioTime);
            } else if (easing === "bezier") {
              const points = 5;
              const curveValues = new Float32Array(points);
              for (let i = 0; i < points; i++) {
                const t = i / (points - 1);
                const smooth = t * t * (3 - 2 * t);
                curveValues[i] = prevGain + (targetGain - prevGain) * smooth;
              }
              this.gainNode.gain.setValueCurveAtTime(
                curveValues,
                prevAudioTime,
                targetAudioTime - prevAudioTime
              );
            } else {
              this.gainNode.gain.linearRampToValueAtTime(targetGain, targetAudioTime);
            }

            prevAudioTime = targetAudioTime;
            prevGain = targetGain;
          }
        }
      }
    }

    // 6. Fade In Envelope (if configured and starting inside fade-in window)
    const fadeInDuration = effective.fadeIn.duration;
    if (fadeInDuration > 0 && timeIntoClip < fadeInDuration && !isMuted) {
      const remainingFadeIn = (fadeInDuration - timeIntoClip) / Math.max(0.01, playbackSpeed);
      this.applyFadeCurve(now, now + remainingFadeIn, 0.0001, startTargetVolume, effective.fadeIn.curve);
    }

    // 7. Fade Out Envelope (if configured)
    const fadeOutDuration = effective.fadeOut.duration;
    const clipDuration = clip.duration;
    if (fadeOutDuration > 0 && !isMuted) {
      const fadeOutStartTimeOffset = clipDuration - fadeOutDuration;
      if (timeIntoClip < clipDuration) {
        const timeUntilFadeOut = Math.max(0, fadeOutStartTimeOffset - timeIntoClip) / Math.max(0.01, playbackSpeed);
        const fadeOutAudioTime = now + timeUntilFadeOut;
        const fadeOutAudioEnd = now + (clipDuration - timeIntoClip) / Math.max(0.01, playbackSpeed);
        const endVolBeforeFade = hasKeyframes
          ? Math.max(0.0001, Math.min(2.0, evaluateAudioKeyframes(sortedKeyframes, fadeOutStartTimeOffset, 1.0, true) * effectiveClipMultiplier))
          : startTargetVolume;
        this.applyFadeCurve(fadeOutAudioTime, fadeOutAudioEnd, endVolBeforeFade, 0.0001, effective.fadeOut.curve);
      }
    }
  }

  /**
   * Apply the clip channel policy before all effects. Standard Web Audio
   * speaker interpretation handles auto/mono/stereo layouts; an explicit map
   * uses a splitter/merger matrix so L/R swaps and custom source selection are
   * not merely persisted metadata in browser preview.
   */
  private configureChannelRouting(channelConfig: ReturnType<typeof evaluateEffectiveAudioState>["channelConfig"]): void {
    try {
      this.routingInput.disconnect();
      this.channelRoutingNodes.forEach((node) => node.disconnect());
      this.channelRoutingNodes = [];

      const map = channelConfig.channelMap?.filter((channel) => Number.isInteger(channel) && channel >= 0);
      if (map?.length && typeof this.ctx.createChannelSplitter === "function" && typeof this.ctx.createChannelMerger === "function") {
        const inputChannels = Math.max(2, ...map.map((channel) => channel + 1));
        const outputChannels = Math.max(2, map.length);
        const splitter = this.ctx.createChannelSplitter(inputChannels);
        const merger = this.ctx.createChannelMerger(outputChannels);
        this.routingInput.connect(splitter);
        map.forEach((sourceChannel, outputChannel) => splitter.connect(merger, sourceChannel, outputChannel));
        merger.connect(this.eqLow);
        this.eqLow.channelCountMode = "explicit";
        this.eqLow.channelCount = outputChannels;
        this.eqLow.channelInterpretation = "speakers";
        this.channelRoutingNodes = [splitter, merger];
      } else {
        this.routingInput.connect(this.eqLow);
        const mono = channelConfig.mode === "mono" || channelConfig.downmix === "mono";
        const stereo = channelConfig.mode === "stereo" || channelConfig.downmix === "stereo";
        this.eqLow.channelCountMode = mono || stereo ? "explicit" : "max";
        this.eqLow.channelCount = mono ? 1 : stereo ? 2 : 2;
        this.eqLow.channelInterpretation = "speakers";
      }
    } catch {
      // Audio routing is an enhancement for browser runtimes. Keep the base
      // chain connected on partial Web Audio implementations used in previews.
      this.routingInput.connect(this.eqLow);
    }
  }

  /**
   * Apply mathematical fade curve to GainNode.
   */
  private applyFadeCurve(
    startTime: number,
    endTime: number,
    startValue: number,
    endValue: number,
    curve: AudioFadeCurve,
  ): void {
    if (endTime <= startTime) return;

    switch (curve) {
      case "exponential":
      case "logarithmic":
      case "s-curve": {
        // Match the canonical curve evaluator used by native preview and the
        // waveform. A value curve also avoids Web Audio's logarithmic-ramp
        // semantics changing the intended editor curve.
        const points = 17;
        const curveValues = new Float32Array(points);
        for (let i = 0; i < points; i++) {
          const t = i / (points - 1);
          const shaped = evaluateFadeCurve(t, curve);
          curveValues[i] = startValue + (endValue - startValue) * shaped;
        }
        this.gainNode.gain.setValueCurveAtTime(curveValues, startTime, endTime - startTime);
        break;
      }
      case "linear":
      default:
        this.gainNode.gain.setValueAtTime(startValue, startTime);
        this.gainNode.gain.linearRampToValueAtTime(endValue, endTime);
        break;
    }
  }

  /**
   * Perform anti-click fast release envelope (3ms) and disconnect all nodes.
   */
  public releaseAndDisconnect(fadeDuration: number = 0.003): Promise<void> {
    return new Promise((resolve) => {
      const now = this.ctx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(Math.max(0.0001, this.gainNode.gain.value), now);
      this.gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeDuration);

      setTimeout(() => {
        try {
          this.eqLow.disconnect();
          this.routingInput.disconnect();
          this.channelRoutingNodes.forEach((node) => node.disconnect());
          this.eqMid.disconnect();
          this.eqHigh.disconnect();
          if (this.pannerNode) this.pannerNode.disconnect();
          this.gainNode.disconnect();
          if (this.compressorNode) this.compressorNode.disconnect();
        } catch {
          // Ignore if already disconnected
        }
        resolve();
      }, (fadeDuration + 0.005) * 1000);
    });
  }
}

/**
 * Mathematically evaluates volume keyframe value at a relative clip timestamp.
 *
 * @param presorted - When true, skips the internal sort (caller guarantees ascending order).
 *   Pass true when you already have a sorted copy (e.g. from applyClipConfig) to avoid
 *   O(n log n) re-allocation on every voice spawn.
 */
export function evaluateKeyframes(
  keyframes: AudioKeyframe[],
  time: number,
  defaultGain: number = 1.0,
  presorted: boolean = false,
): number {
  return evaluateAudioKeyframes(keyframes, time, defaultGain, presorted);
}
