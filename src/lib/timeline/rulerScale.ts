/**
 * Timeline ruler scale selection.
 *
 * The ruler's cadence is independent from filmstrip density: it chooses the
 * smallest readable "nice" interval for the current pixels-per-second. At
 * close zoom levels that interval is an integral number of source frames;
 * once one second is more readable, labels promote to timeline timecode.
 */

export type TimelineRulerScale = {
  majorIntervalSeconds: number;
  minorIntervalSeconds: number;
  labelMode: "frames" | "timecode";
};

type RulerScaleCandidate = {
  intervalSeconds: number;
  minorDivisions: number;
  labelMode: TimelineRulerScale["labelMode"];
};

/** CapCut-style visual spacing: dense enough to read, never crowded. */
export const MIN_RULER_LABEL_GAP_PX = 60;

const SECOND_CANDIDATES: ReadonlyArray<
  Omit<RulerScaleCandidate, "labelMode">
> = [
  { intervalSeconds: 1, minorDivisions: 5 },
  { intervalSeconds: 2, minorDivisions: 4 },
  { intervalSeconds: 3, minorDivisions: 3 },
  { intervalSeconds: 5, minorDivisions: 5 },
  { intervalSeconds: 10, minorDivisions: 5 },
  { intervalSeconds: 15, minorDivisions: 3 },
  { intervalSeconds: 30, minorDivisions: 6 },
  { intervalSeconds: 60, minorDivisions: 6 },
  { intervalSeconds: 120, minorDivisions: 4 },
  { intervalSeconds: 300, minorDivisions: 5 },
];

/**
 * Select a readable major/minor ruler cadence for a zoom level.
 *
 * Frame intervals are generated from the sequence rate, avoiding fractional
 * frame labels for 24, 25, 30, and 60 fps projects.
 */
export function getTimelineRulerScale(
  pixelsPerSecond: number,
  frameRate: number,
): TimelineRulerScale {
  const safePps =
    Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0
      ? pixelsPerSecond
      : 50;
  const safeFps =
    Number.isFinite(frameRate) && frameRate > 0 ? Math.round(frameRate) : 30;

  const frameCandidates: RulerScaleCandidate[] = [1, 2, 5, 10, 15]
    .filter((frames) => frames < safeFps)
    .map((frames) => ({
      intervalSeconds: frames / safeFps,
      minorDivisions:
        frames <= 2 ? frames : frames === 5 ? 5 : frames === 10 ? 5 : 3,
      labelMode: "frames" as const,
    }));

  const candidates: RulerScaleCandidate[] = [
    ...frameCandidates,
    ...SECOND_CANDIDATES.map((candidate) => ({
      ...candidate,
      labelMode: "timecode" as const,
    })),
  ];

  const selected =
    candidates.find(
      (candidate) =>
        candidate.intervalSeconds * safePps >= MIN_RULER_LABEL_GAP_PX,
    ) ?? candidates[candidates.length - 1];

  return {
    majorIntervalSeconds: selected.intervalSeconds,
    minorIntervalSeconds:
      selected.intervalSeconds / selected.minorDivisions,
    labelMode: selected.labelMode,
  };
}

/** Format a major ruler tick in its currently active precision domain. */
export function formatTimelineRulerLabel(
  seconds: number,
  frameRate: number,
  labelMode: TimelineRulerScale["labelMode"],
  formatTimecode: (seconds: number, frameRate: number) => string,
): string {
  const safeFps =
    Number.isFinite(frameRate) && frameRate > 0 ? Math.round(frameRate) : 30;

  if (labelMode === "timecode") {
    return formatTimecode(seconds, safeFps);
  }

  const totalFrames = Math.max(0, Math.round(seconds * safeFps));
  const frameInSecond = totalFrames % safeFps;

  // On whole-second boundaries at frame zoom, CapCut displays the sequence timecode
  // (e.g. 00:28) rather than cumulative sequence frames.
  if (frameInSecond === 0) {
    return formatTimecode(totalFrames / safeFps, safeFps);
  }

  // Inside the second, display the frame index within that second (e.g. 2f, 4f, 6f).
  return `${frameInSecond}f`;
}
