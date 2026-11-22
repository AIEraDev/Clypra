/**
 * MediaAnalysisWorker — Consolidated Off-Thread Media Analysis Engine (Domain Worker 2)
 *
 * Combines media telemetry, audio pyramid generation, and stream analysis in a single persistent isolate:
 * 1. Audio waveform multi-LOD peak/RMS pyramid generation & zero-copy viewport slicing
 * 2. Real-time 60fps Video Color Scopes (Histogram, RGB Parade, Vectorscope) via OffscreenCanvas
 * 3. Subtitle & transcript tokenization and layout for SRT, WebVTT, and Whisper segments
 */

import type {
  WaveformBuildRequest,
  WaveformSliceRequest,
  WaveformEvictRequest,
  WaveformBuildReady,
  WaveformSliceResult,
  ScopeAnalyzeRequest,
  ScopeAnalyzeResult,
  ParseSubtitlesRequest,
  LayoutCuesRequest,
  ParseResult,
  LayoutResult,
  ParsedCaptionCue,
  LayoutedCaptionCue,
  WhisperWordSegment,
  WorkerErrorResponse,
} from "./types";
import {
  computeColorScopesVectorized,
  computeWaveformLodVectorized,
} from "@/core/workers/vectorCompute";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Audio Waveform Multi-LOD Pyramid & Viewport Slicer
// ═══════════════════════════════════════════════════════════════════════════════

interface LodLevel {
  step: number;
  peaks: Float32Array;
  rms: Float32Array;
}

interface WaveformPyramid {
  mediaId: string;
  totalSamples: number;
  sampleRate: number;
  durationSeconds: number;
  levels: LodLevel[];
}

const pyramids = new Map<string, WaveformPyramid>();
const DEFAULT_LOD_STEPS = [100, 1_000, 10_000, 100_000];

function downmixToMono(pcm: Float32Array, channelCount: number): Float32Array {
  if (channelCount <= 1) return pcm;

  const totalFrames = Math.floor(pcm.length / channelCount);
  const mono = new Float32Array(totalFrames);

  // Fast path for stereo (99% of video editor audio)
  if (channelCount === 2) {
    for (let frame = 0; frame < totalFrames; frame++) {
      const offset = frame * 2;
      mono[frame] = (pcm[offset] + pcm[offset + 1]) * 0.5;
    }
    return mono;
  }

  const invChannelCount = 1 / channelCount;
  for (let frame = 0; frame < totalFrames; frame++) {
    let sum = 0;
    const offset = frame * channelCount;
    for (let ch = 0; ch < channelCount; ch++) {
      sum += pcm[offset + ch];
    }
    mono[frame] = sum * invChannelCount;
  }

  return mono;
}

function buildPyramidLevel(monoPcm: Float32Array, step: number): LodLevel {
  return computeWaveformLodVectorized(monoPcm, step);
}

function handleWaveformBuild(msg: WaveformBuildRequest): void {
  const { mediaId, pcm, channelCount = 1, sampleRate = 48000, lodSteps } = msg;

  const mono = downmixToMono(pcm, channelCount);
  const totalSamples = mono.length;
  const durationSeconds = totalSamples / sampleRate;

  const steps = lodSteps ?? DEFAULT_LOD_STEPS;
  const levels: LodLevel[] = steps.map((step) =>
    buildPyramidLevel(mono, step),
  );

  pyramids.set(mediaId, {
    mediaId,
    totalSamples,
    sampleRate,
    durationSeconds,
    levels,
  });

  const response: WaveformBuildReady = {
    type: "LOD_READY",
    mediaId,
    totalSamples,
    durationSeconds,
  };

  (self as unknown as Worker).postMessage(response);
}

function handleWaveformSlice(msg: WaveformSliceRequest): void {
  const { id, mediaId, startSample, endSample, pixelWidth } = msg;
  const pyramid = pyramids.get(mediaId);

  if (!pyramid) {
    throw new Error(`WaveformPyramid for mediaId "${mediaId}" not found`);
  }

  const { totalSamples, levels } = pyramid;
  const clampedStart = Math.max(0, startSample);
  const clampedEnd = Math.min(totalSamples, endSample);
  const windowSamples = Math.max(1, clampedEnd - clampedStart);

  const desiredStep = Math.max(1, Math.floor(windowSamples / pixelWidth));

  let chosenLevel = levels[0];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i].step <= desiredStep) {
      chosenLevel = levels[i];
      break;
    }
  }

  const { step, peaks, rms } = chosenLevel;
  const startBucket = Math.floor(clampedStart / step);
  const endBucket = Math.min(peaks.length, Math.ceil(clampedEnd / step));
  const sourceBucketCount = Math.max(1, endBucket - startBucket);

  const outPeaks = new Float32Array(pixelWidth);
  const outRms = new Float32Array(pixelWidth);

  for (let i = 0; i < pixelWidth; i++) {
    const offsetStart = Math.floor((i / pixelWidth) * sourceBucketCount);
    const offsetEnd = Math.max(
      offsetStart + 1,
      Math.floor(((i + 1) / pixelWidth) * sourceBucketCount),
    );
    const srcIndexStart = startBucket + offsetStart;
    const srcIndexEnd = Math.min(peaks.length, startBucket + offsetEnd);

    let maxP = 0;
    let sumR = 0;
    let cnt = 0;

    for (let s = srcIndexStart; s < srcIndexEnd; s++) {
      if (peaks[s] > maxP) maxP = peaks[s];
      sumR += rms[s];
      cnt++;
    }

    outPeaks[i] = maxP;
    outRms[i] = cnt > 0 ? sumR / cnt : 0;
  }

  const result: WaveformSliceResult = {
    type: "SLICE_RESULT",
    id,
    peaks: outPeaks,
    rms: outRms,
    samplesPerPixel: step,
  };

  (self as unknown as Worker).postMessage(result, [outPeaks.buffer, outRms.buffer]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Video Color Scopes (Histogram, Vectorscope, RGB Parade)
// ═══════════════════════════════════════════════════════════════════════════════

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

/** Fixed analysis resolution — GPU bilinear downscale handles quality, not stride. */
const SCOPE_ANALYSIS_W = 256;
const SCOPE_ANALYSIS_H = 144;

function getScopeContext(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!offscreenCtx) throw new Error("OffscreenCanvas 2D context not available");
  return offscreenCtx;
}

function handleColorScopeAnalyze(msg: ScopeAnalyzeRequest): void {
  const startMs = performance.now();
  const { id, frame, enabledScopes } = msg;

  // Downscale to fixed 256×144 before getImageData.
  // The GPU bilinear filter during drawImage acts as a proper area-average
  // downsampler — far cheaper than reading back 2M pixels at 60fps.
  // Pixel count drops from ~2 M (1080p) to ~37 K — a 54× reduction.
  const ctx = getScopeContext(SCOPE_ANALYSIS_W, SCOPE_ANALYSIS_H);
  ctx.drawImage(frame, 0, 0, SCOPE_ANALYSIS_W, SCOPE_ANALYSIS_H);

  try {
    frame.close();
  } catch {
    // ignore
  }

  const imgData = ctx.getImageData(0, 0, SCOPE_ANALYSIS_W, SCOPE_ANALYSIS_H);
  const data = imgData.data;
  const width = SCOPE_ANALYSIS_W;
  const height = SCOPE_ANALYSIS_H;

  const result: ScopeAnalyzeResult = {
    type: "SCOPE_RESULT",
    id,
    analysisMs: 0,
  };

  const transferList: Transferable[] = [];

  const needHistogram = enabledScopes.includes("histogram");
  const needVectorscope = enabledScopes.includes("vectorscope");
  const needParade = enabledScopes.includes("parade");

  const scoped = computeColorScopesVectorized(data, width, height, {
    needHistogram,
    needVectorscope,
    needParade,
  });

  if (needHistogram && scoped.histogram) {
    result.histogram = scoped.histogram;
    transferList.push(
      scoped.histogram.r.buffer,
      scoped.histogram.g.buffer,
      scoped.histogram.b.buffer,
      scoped.histogram.luma.buffer,
    );
  }

  if (needVectorscope && scoped.vectorscope) {
    result.vectorscope = scoped.vectorscope;
    transferList.push(scoped.vectorscope.buffer);
  }

  if (needParade && scoped.parade) {
    result.parade = scoped.parade;
    transferList.push(scoped.parade.buffer);
  }

  result.analysisMs = performance.now() - startMs;
  (self as unknown as Worker).postMessage(result, transferList);
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. Subtitle & Transcript Parser Engine
// ═══════════════════════════════════════════════════════════════════════════════

function parseSubtitleTimecode(str: string): number {
  const clean = str.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    return (
      parseFloat(parts[0]) * 3600 +
      parseFloat(parts[1]) * 60 +
      parseFloat(parts[2])
    );
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(clean) || 0;
}

function parseSrtOrVtt(content: string): ParsedCaptionCue[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const rawBlocks = normalized.split(/\n\n+/);
  const cues: ParsedCaptionCue[] = [];
  let counter = 1;

  for (const block of rawBlocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    if (
      lines[0].startsWith("WEBVTT") ||
      lines[0].startsWith("STYLE") ||
      lines[0].startsWith("NOTE")
    ) {
      continue;
    }

    let timeLineIdx = 0;
    let customId: string | undefined;

    if (!lines[0].includes("-->")) {
      customId = lines[0].trim();
      timeLineIdx = 1;
    }

    if (timeLineIdx >= lines.length || !lines[timeLineIdx].includes("-->")) {
      continue;
    }

    const [startRaw, endRaw] = lines[timeLineIdx].split("-->");
    if (!startRaw || !endRaw) continue;

    const startTime = parseSubtitleTimecode(startRaw);
    const endTime = parseSubtitleTimecode(endRaw.trim().split(" ")[0]);
    const text = lines
      .slice(timeLineIdx + 1)
      .join("\n")
      .replace(/<[^>]*>/g, "")
      .trim();

    if (text) {
      cues.push({
        id: customId || `cue-${counter++}`,
        startTime,
        endTime,
        text,
      });
    }
  }

  return cues;
}

function parseWhisperSegments(segments: WhisperWordSegment[]): ParsedCaptionCue[] {
  return segments.map((seg, idx) => ({
    id: `whisper-${idx + 1}`,
    startTime: seg.startTime,
    endTime: seg.endTime,
    text: seg.word.trim(),
    words: [
      {
        word: seg.word.trim(),
        startTime: seg.startTime,
        endTime: seg.endTime,
      },
    ],
  }));
}

function handleSubtitleParse(msg: ParseSubtitlesRequest): void {
  const startMs = performance.now();
  const { id, format, rawText, whisperSegments } = msg;
  let cues: ParsedCaptionCue[] = [];

  if (format === "whisper" && whisperSegments) {
    cues = parseWhisperSegments(whisperSegments);
  } else if (rawText) {
    cues = parseSrtOrVtt(rawText);
  }

  const durationSeconds = cues.length > 0 ? cues[cues.length - 1].endTime : 0;

  const result: ParseResult = {
    type: "PARSE_RESULT",
    id,
    cues,
    durationSeconds,
    parseMs: performance.now() - startMs,
  };

  (self as unknown as Worker).postMessage(result);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compute DoS Quotas & Defensive Boundaries
// ═══════════════════════════════════════════════════════════════════════════════

export const COMPUTE_LIMITS = {
  MAX_WAVEFORM_SAMPLES: 48000 * 3600, // 1 hour max single audio clip (~172.8M samples)
  MAX_SUBTITLE_BYTES: 10 * 1024 * 1024, // 10 MB raw subtitle text
  MAX_SCOPE_CANVAS_DIMENSION: 4096,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Message Router
// ═══════════════════════════════════════════════════════════════════════════════

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      // Audio Waveform LOD
      case "BUILD_LOD": {
        const buildReq = msg as WaveformBuildRequest;
        if (buildReq.pcm && buildReq.pcm.length > COMPUTE_LIMITS.MAX_WAVEFORM_SAMPLES) {
          throw new Error(
            `Security Violation: Audio samples (${buildReq.pcm.length}) exceed maximum compute limit (1 hour)`,
          );
        }
        handleWaveformBuild(buildReq);
        break;
      }
      case "SLICE_VIEWPORT":
        handleWaveformSlice(msg as WaveformSliceRequest);
        break;
      case "EVICT":
        pyramids.delete((msg as WaveformEvictRequest).mediaId);
        break;

      // Video Color Scopes
      case "ANALYZE": {
        const scopeReq = msg as ScopeAnalyzeRequest;
        if (
          scopeReq.frame &&
          (scopeReq.frame.width > COMPUTE_LIMITS.MAX_SCOPE_CANVAS_DIMENSION ||
            scopeReq.frame.height > COMPUTE_LIMITS.MAX_SCOPE_CANVAS_DIMENSION)
        ) {
          throw new Error(
            `Security Violation: Color scope frame dimensions (${scopeReq.frame.width}x${scopeReq.frame.height}) exceed maximum allowable size (4096)`,
          );
        }
        handleColorScopeAnalyze(scopeReq);
        break;
      }

      // Subtitles & Transcripts
      case "PARSE_SUBTITLES": {
        const subReq = msg as ParseSubtitlesRequest;
        if (subReq.rawText && subReq.rawText.length > COMPUTE_LIMITS.MAX_SUBTITLE_BYTES) {
          throw new Error(
            `Security Violation: Subtitle payload (${subReq.rawText.length} bytes) exceeds maximum allowable size (10 MB)`,
          );
        }
        handleSubtitleParse(subReq);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    const errorResponse: WorkerErrorResponse = {
      type: "ERROR",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};
