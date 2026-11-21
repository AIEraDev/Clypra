import {
  replayScrubTrace,
  scrubTraceHasMonotonicPresentation,
  shouldDropForAudioLateness,
} from "../scrubTraceReplay";

describe("scrub trace replay", () => {
  it("presents monotonic forward frames and settles the last target exactly", () => {
    const result = replayScrubTrace(
      [
        { targetFrame: 10, atMs: 0, intent: "scrub" },
        { targetFrame: 11, atMs: 5, intent: "scrub" },
        { targetFrame: 12, atMs: 10, intent: "scrub" },
        { targetFrame: 42, atMs: 15, intent: "scrub", released: true },
      ],
      20,
    );

    expect(scrubTraceHasMonotonicPresentation(result.presentations)).toBe(true);
    expect(result.presentations.map((frame) => frame.frameIndex)).toEqual([10, 42]);
    expect(result.presentations[result.presentations.length - 1]).toMatchObject({
      frameIndex: 42,
      exact: true,
    });
  });

  it("replaces queued targets so the latest mailbox target wins", () => {
    const result = replayScrubTrace(
      [
        { targetFrame: 100, atMs: 0, intent: "scrub" },
        { targetFrame: 101, atMs: 1, intent: "scrub" },
        { targetFrame: 102, atMs: 2, intent: "scrub" },
        { targetFrame: 103, atMs: 3, intent: "scrub", released: true },
      ],
      10,
    );

    expect(result.terminals).toEqual(
      expect.arrayContaining([
        { targetFrame: 101, outcome: "superseded" },
        { targetFrame: 102, outcome: "superseded" },
      ]),
    );
    expect(result.presentations[result.presentations.length - 1]?.frameIndex).toBe(103);
  });

  it("keeps the audio-lateness drop for playback intent only", () => {
    expect(shouldDropForAudioLateness("scrub", true)).toBe(false);
    expect(shouldDropForAudioLateness("seek", true)).toBe(false);
    expect(shouldDropForAudioLateness("playback", true)).toBe(true);

    const result = replayScrubTrace(
      [
        { targetFrame: 7, atMs: 0, intent: "playback", lateForAudio: true },
        { targetFrame: 8, atMs: 1, intent: "scrub", lateForAudio: true, released: true },
      ],
      10,
    );
    expect(result.terminals).toContainEqual({
      targetFrame: 7,
      outcome: "dropped-before-present",
      reason: "late-for-audio",
    });
    expect(result.presentations[result.presentations.length - 1]?.frameIndex).toBe(8);
  });
});
