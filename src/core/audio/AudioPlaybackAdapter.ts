/**
 * AudioPlaybackAdapter — Unified Audio Engine Abstraction
 *
 * Consolidates Desktop CPAL (NativeAudioPreviewController) and Browser
 * Web Audio API (AudioEngine) behind a single authoritative interface.
 */

import type { Clip, MediaAsset, Track } from "@/types";
import { PlaybackClock, getPlaybackClock } from "@/core/playback/PlaybackClock";
import { isTauriRuntime, getNativeAudioDiagnostics } from "@/lib/platform/tauri";
import {
  NativeAudioPreviewController,
  type NativeAudioPreviewSource,
} from "./nativeAudioPreviewController";
import { AudioEngine, type AudioEngineTelemetrySnapshot } from "./AudioEngine";
import {
  getSharedAudioEngine,
  resumeSharedAudioEngine,
  stopSharedAudioEngine,
} from "./audioRuntime";

export interface AudioPlaybackSource {
  projectRevision: string;
  frameRate: number;
  duration: number;
  audioTrackCount: number;
  clips: Clip[];
  tracks: Track[];
  assets: MediaAsset[];
}

export interface AudioDiagnosticsSnapshot {
  kind: "native" | "web-audio";
  activeVoices?: number;
  bufferPoolUsageBytes?: number;
  callbackCount?: number;
  renderedFrames?: number;
  nonSilentFrames?: number;
  mixerLockMisses?: number;
  callbackTimeUs?: number;
  callbackMaxTimeUs?: number;
  callbackOverBudgetCount?: number;
  lastError?: string | null;
}

export interface AudioPlaybackAdapter {
  readonly kind: "native" | "web-audio";
  readonly isActive: boolean;
  initialize(source: AudioPlaybackSource): Promise<void>;
  updateSource(source: AudioPlaybackSource): void;
  setOutput(volume: number, muted: boolean): void;
  resume(): Promise<void>;
  stop(): void;
  dispose(): Promise<void>;
  getDiagnostics(): Promise<AudioDiagnosticsSnapshot | null>;
}

export interface CreateAudioPlaybackAdapterOptions {
  clock?: PlaybackClock;
  forceKind?: "native" | "web-audio";
  onError?: (error: Error) => void;
}

/**
 * Desktop CPAL Native Audio Adapter
 */
export class NativeAudioPlaybackAdapter implements AudioPlaybackAdapter {
  readonly kind = "native" as const;
  private controller: NativeAudioPreviewController | null = null;
  private readonly clock: PlaybackClock;
  private readonly onError?: (error: Error) => void;

  constructor(options: CreateAudioPlaybackAdapterOptions = {}) {
    this.clock = options.clock ?? getPlaybackClock();
    this.onError = options.onError;
  }

  get isActive(): boolean {
    return this.controller?.isActive ?? false;
  }

  async initialize(source: AudioPlaybackSource): Promise<void> {
    if (this.controller) {
      await this.controller.dispose();
    }
    this.controller = new NativeAudioPreviewController({
      clock: this.clock,
      source: source as NativeAudioPreviewSource,
      onError: this.onError,
    });
    await this.controller.initialize();
  }

  updateSource(source: AudioPlaybackSource): void {
    this.controller?.updateSource(source as NativeAudioPreviewSource);
  }

  setOutput(volume: number, muted: boolean): void {
    this.controller?.setOutput(volume, muted);
  }

  async resume(): Promise<void> {
    // Native CPAL stream is driven by clock transport
  }

  stop(): void {
    // Native CPAL pauses via transport controls
  }

  async dispose(): Promise<void> {
    if (this.controller) {
      const ctrl = this.controller;
      this.controller = null;
      await ctrl.dispose();
    }
  }

  async getDiagnostics(): Promise<AudioDiagnosticsSnapshot | null> {
    if (!isTauriRuntime()) return null;
    try {
      const diag = await getNativeAudioDiagnostics();
      if (!diag?.status) return null;
      return {
        kind: "native",
        callbackCount: diag.status.callbackCount,
        renderedFrames: diag.status.renderedFrames,
        nonSilentFrames: diag.status.nonSilentFrames,
        mixerLockMisses: diag.status.mixerLockMisses,
        callbackTimeUs: diag.status.callbackTimeUs,
        callbackMaxTimeUs: diag.status.callbackMaxTimeUs,
        callbackOverBudgetCount: diag.status.callbackOverBudgetCount,
        lastError: diag.status.lastError,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Browser Web Audio API Adapter
 */
export class WebAudioPlaybackAdapter implements AudioPlaybackAdapter {
  readonly kind = "web-audio" as const;
  private readonly engine: AudioEngine;
  private active = false;

  constructor(engine?: AudioEngine) {
    this.engine = engine ?? getSharedAudioEngine();
  }

  get isActive(): boolean {
    return this.active;
  }

  async initialize(_source: AudioPlaybackSource): Promise<void> {
    this.active = true;
  }

  updateSource(_source: AudioPlaybackSource): void {
    // Web Audio engine syncs dynamically during RAF loop
  }

  setOutput(volume: number, muted: boolean): void {
    this.engine.syncPlayback([], [], 0, false, 1.0, volume, muted);
  }

  async resume(): Promise<void> {
    await resumeSharedAudioEngine();
  }

  stop(): void {
    stopSharedAudioEngine();
  }

  async dispose(): Promise<void> {
    this.active = false;
    this.engine.stopAllVoices(false);
  }

  async getDiagnostics(): Promise<AudioDiagnosticsSnapshot | null> {
    const telemetry: AudioEngineTelemetrySnapshot = this.engine.takeTelemetrySnapshot();
    return {
      kind: "web-audio",
      activeVoices: telemetry.activeVoiceCount,
      bufferPoolUsageBytes: this.engine.bufferPool.getStats().usedBytes,
      lastError: null,
    };
  }
}

/**
 * Factory function to create the environment-appropriate audio playback adapter.
 */
export function createAudioPlaybackAdapter(
  options: CreateAudioPlaybackAdapterOptions = {},
): AudioPlaybackAdapter {
  const useNative =
    options.forceKind === "native" ||
    (options.forceKind === undefined && isTauriRuntime());

  if (useNative) {
    return new NativeAudioPlaybackAdapter(options);
  }
  return new WebAudioPlaybackAdapter();
}
