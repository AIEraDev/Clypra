import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackClock } from "@/core/playback/PlaybackClock";
import {
  NativeAudioPreviewController,
  type NativeAudioPreviewSource,
} from "../nativeAudioPreviewController";
import {
  getNativeAudioStatus,
  nativePlayFromAudio,
  nativeTickFromAudio,
  seekNativeAudio,
} from "@/lib/platform/tauri";
import type { NativePlaybackState } from "@/lib/platform/nativeCore";
import {
  buildNativeAudioTimeline,
  syncNativeAudioTimeline,
} from "../nativeAudioTimeline";

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
  configureNativePlayback: vi.fn().mockResolvedValue(undefined),
  getNativeAudioStatus: vi.fn().mockResolvedValue({ audioPositionTicks: 0 }),
  getNativeAudioDiagnostics: vi.fn().mockResolvedValue({
    status: { callbackCount: 0, nonSilentFrames: 0 },
    installedClips: [],
  }),
  nativePauseFromAudio: vi.fn().mockResolvedValue({ audioPositionTicks: 0 }),
  nativePlayFromAudio: vi.fn().mockResolvedValue({ audioPositionTicks: 0 }),
  nativeSeekFromAudio: vi.fn().mockResolvedValue({ audioPositionTicks: 0 }),
  nativeTickFromAudio: vi.fn(),
  pauseNativeAudio: vi.fn().mockResolvedValue(undefined),
  seekNativeAudio: vi.fn().mockResolvedValue(undefined),
  setNativeAudioOutput: vi.fn().mockResolvedValue(undefined),
  setNativeAudioSpeed: vi.fn().mockResolvedValue(undefined),
  stopNativeAudio: vi.fn().mockResolvedValue(undefined),
  updateNativeAudioClipParameters: vi.fn().mockResolvedValue(undefined),
  updateNativeAudioClipParametersBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../nativeAudioTimeline", () => ({
  buildNativeAudioTimeline: vi.fn().mockReturnValue({ clips: [] }),
  syncNativeAudioTimeline: vi.fn().mockResolvedValue({
    snapshot: { clips: [] },
    installedCount: 0,
  }),
}));

const source: NativeAudioPreviewSource = {
  projectRevision: "polling-regression",
  frameRate: 30,
  duration: 30,
  audioTrackCount: 1,
  clips: [],
  tracks: [],
  assets: [],
};

function nativeState(audioPositionTicks: number): NativePlaybackState {
  return {
    contractVersion: 1,
    projectRevision: source.projectRevision,
    audioPositionTicks,
    presentedFrame: null,
    droppedFrames: 0,
    buffering: false,
    clockStatus: "audio",
  };
}

/** Test-only view of the polling boundary; production ownership remains private. */
interface PollingControllerHarness {
  active: boolean;
  lastState: ReturnType<PlaybackClock["getState"]> | null;
  transportQueue: Promise<void>;
  sourceSyncQueue: Promise<void>;
  _rendererState: string;
  handleClockState(state: ReturnType<PlaybackClock["getState"]>): void;
  pollNativeClock(): Promise<void>;
  invalidateNativeClockPolls(): void;
}

function pollingHarness(
  controller: NativeAudioPreviewController,
): PollingControllerHarness {
  return controller as unknown as PollingControllerHarness;
}

describe("NativeAudioPreviewController native clock polling", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("REGRESSION: does not overlap native clock polls while a delayed poll is unresolved", async () => {
    const clock = new PlaybackClock();
    clock.setDuration(source.duration);
    clock.setNativeClockAuthority(true);
    clock.play();

    const controller = new NativeAudioPreviewController({ clock, source });
    const polling = pollingHarness(controller);
    polling.active = true;

    let resolveFirstPoll!: (value: NativePlaybackState) => void;
    vi.mocked(nativeTickFromAudio).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstPoll = resolve;
        }) as ReturnType<typeof nativeTickFromAudio>,
    );

    const firstPoll = polling.pollNativeClock();
    const overlappingPoll = polling.pollNativeClock();

    expect(nativeTickFromAudio).toHaveBeenCalledTimes(1);

    resolveFirstPoll(nativeState(1_000_000));
    await Promise.all([firstPoll, overlappingPoll]);

    await polling.pollNativeClock();
    expect(nativeTickFromAudio).toHaveBeenCalledTimes(2);

    await controller.dispose();
    clock.dispose();
  });

  it("drops a delayed poll once a same-run seek invalidates its observation", async () => {
    const clock = new PlaybackClock();
    clock.setDuration(source.duration);
    clock.setNativeClockAuthority(true);
    clock.play();

    const controller = new NativeAudioPreviewController({ clock, source });
    const polling = pollingHarness(controller);
    polling.active = true;
    const adoptPosition = vi.spyOn(clock, "setNativeClockPosition");
    let resolvePoll!: (value: NativePlaybackState) => void;
    vi.mocked(nativeTickFromAudio).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }) as ReturnType<typeof nativeTickFromAudio>,
    );

    const delayedPoll = polling.pollNativeClock();
    polling.invalidateNativeClockPolls();
    resolvePoll(nativeState(8_000_000));
    await delayedPoll;

    expect(adoptPosition).not.toHaveBeenCalled();

    await controller.dispose();
    clock.dispose();
  });

  it("REGRESSION: immediate Play rejects a pre-play native position instead of rewinding the playhead", async () => {
    const clock = new PlaybackClock();
    clock.setDuration(source.duration);
    clock.setNativeClockAuthority(true);
    clock.seek(5);

    const controller = new NativeAudioPreviewController({ clock, source });
    const polling = pollingHarness(controller);
    polling.active = true;
    polling.lastState = clock.getState();
    const unsubscribe = clock.subscribe((state) => polling.handleClockState(state));
    vi.mocked(nativePlayFromAudio).mockResolvedValueOnce(nativeState(0));

    clock.play();
    await polling.transportQueue;
    vi.mocked(nativeTickFromAudio).mockResolvedValue(nativeState(0));
    await polling.pollNativeClock();

    expect(nativePlayFromAudio).toHaveBeenCalledTimes(1);
    expect(clock.time).toBeGreaterThanOrEqual(4.9);

    unsubscribe();
    await controller.dispose();
    clock.dispose();
  });

  it("REGRESSION: paused seek rejects spurious 0-tick native status during background audio sync", async () => {
    const clock = new PlaybackClock();
    clock.setDuration(source.duration);
    clock.setNativeClockAuthority(true);
    // User seeks forward to 10 seconds while paused
    clock.seek(10);

    const controller = new NativeAudioPreviewController({ clock, source });
    const polling = pollingHarness(controller);
    polling.active = true;
    polling.lastState = clock.getState();

    const adoptPosition = vi.spyOn(clock, "setNativeClockPosition");
    // Simulate background native audio status returning 0 (uninitialized stream)
    vi.mocked(getNativeAudioStatus).mockResolvedValueOnce({ audioPositionTicks: 0 } as any);

    await polling.pollNativeClock();

    // Must NOT adopt 0 or wipe the user's seek!
    expect(adoptPosition).not.toHaveBeenCalledWith(0, expect.anything(), expect.anything(), expect.anything());
    expect(clock.time).toBe(10);

    await controller.dispose();
    clock.dispose();
  });

  it("REGRESSION: updateSource re-seeks paused native audio to current clock position", async () => {
    const clock = new PlaybackClock();
    clock.setDuration(source.duration);
    clock.setNativeClockAuthority(true);
    clock.seek(7.5);

    const controller = new NativeAudioPreviewController({ clock, source });
    const polling = pollingHarness(controller);
    polling.active = true;
    polling.lastState = clock.getState();

    vi.mocked(seekNativeAudio).mockClear();
    vi.mocked(buildNativeAudioTimeline).mockReturnValueOnce({
      clips: [{ clipId: "c1" } as any],
    } as any);
    vi.mocked(syncNativeAudioTimeline).mockResolvedValueOnce({
      snapshot: { clips: [{ clipId: "c1" } as any] },
      installedCount: 1,
    } as any);

    // Trigger updateSource with a new source snapshot while paused
    const nextSource = { ...source, projectRevision: "revision-2" };
    controller.updateSource(nextSource);
    await polling.sourceSyncQueue;
    await polling.transportQueue;

    // Must have enqueued a seek to 7.5s (7_500_000 ticks) in CPAL
    expect(seekNativeAudio).toHaveBeenCalledWith(7_500_000);

    await controller.dispose();
    clock.dispose();
  });

  it("REGRESSION: updateSource resumes playback when clock is playing even if rendererState was ready", async () => {
    const clock = new PlaybackClock();
    clock.setDuration(source.duration);
    clock.setNativeClockAuthority(true);
    clock.seek(3.0);
    clock.play();

    const controller = new NativeAudioPreviewController({ clock, source });
    const polling = pollingHarness(controller);
    polling.active = true;
    polling._rendererState = "ready"; // Not "resolving"
    polling.lastState = clock.getState();

    vi.mocked(nativePlayFromAudio).mockClear();
    vi.mocked(nativePlayFromAudio).mockResolvedValueOnce(nativeState(3_000_000));
    vi.mocked(buildNativeAudioTimeline).mockReturnValueOnce({
      clips: [{ clipId: "c1" } as any],
    } as any);
    vi.mocked(syncNativeAudioTimeline).mockResolvedValueOnce({
      snapshot: { clips: [{ clipId: "c1" } as any] },
      installedCount: 1,
    } as any);

    const nextSource = { ...source, projectRevision: "revision-3" };
    controller.updateSource(nextSource);
    await polling.sourceSyncQueue;
    await polling.transportQueue;

    expect(nativePlayFromAudio).toHaveBeenCalled();

    await controller.dispose();
    clock.dispose();
  });
});
