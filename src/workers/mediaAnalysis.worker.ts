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

  for (let frame = 0; frame < totalFrames; frame++) {
    let sum = 0;
    const offset = frame * channelCount;
    for (let ch = 0; ch < channelCount; ch++) {
      sum += pcm[offset + ch];
    }
    mono[frame] = sum / channelCount;
  }

  return mono;
}

function buildPyramidLevel(monoPcm: Float32Array, step: number): LodLevel {
  const totalSamples = monoPcm.length;
  const bucketCount = Math.max(1, Math.ceil(totalSamples / step));
  const peaks = new Float32Array(bucketCount);
  const rms = new Float32Array(bucketCount);

  for (let b = 0; b < bucketCount; b++) {
    const start = b * step;
    const end = Math.min(start + step, totalSamples);
    let maxVal = 0;
    let sumSq = 0;
    const count = end - start;

    for (let i = start; i < end; i++) {
      const abs = Math.abs(monoPcm[i]);
      if (abs > maxVal) maxVal = abs;
      sumSq += abs * abs;
    }

    peaks[b] = Math.min(1.0, maxVal);
    rms[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  return { step, peaks, rms };
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
    const srcIndexStart = startBucket + Math.floor((i / pixelWidth) * sourceBucketCount);
    const srcIndexEnd =
      startBucket +
      Math.max(
        srcIndexStart + 1,
        Math.floor(((i + 1) / pixelWidth) * sourceBucketCount),
      );

    let maxP = 0;
    let sumR = 0;
    let cnt = 0;

    for (let s = srcIndexStart; s < Math.min(srcIndexEnd, peaks.length); s++) {
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
  const { id, frame, enabledScopes, downsampleFactor = 2 } = msg;

  const width = frame.width;
  const height = frame.height;
  const stride = Math.max(1, Math.round(downsampleFactor));

  const ctx = getScopeContext(width, height);
  ctx.drawImage(frame, 0, 0);

  try {
    frame.close();
  } catch {
    // ignore
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const result: ScopeAnalyzeResult = {
    type: "SCOPE_RESULT",
    id,
    analysisMs: 0,
  };

  const transferList: Transferable[] = [];

  const needHistogram = enabledScopes.includes("histogram");
  const needVectorscope = enabledScopes.includes("vectorscope");
  const needParade = enabledScopes.includes("parade");

  let histR: Uint32Array | undefined;
  let histG: Uint32Array | undefined;
  let histB: Uint32Array | undefined;
  let histLuma: Uint32Array | undefined;

  if (needHistogram) {
    histR = new Uint32Array(256);
    histG = new Uint32Array(256);
    histB = new Uint32Array(256);
    histLuma = new Uint32Array(256);
  }

  const vectorPoints: number[] = [];
  const paradeData: number[] = [];

  for (let y = 0; y < height; y += stride) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += stride) {
      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const luma = Math.min(255, Math.max(0, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));

      if (needHistogram) {
        histR![r]++;
        histG![g]++;
        histB![b]++;
        histLuma![luma]++;
      }

      if (needVectorscope) {
        const u = -0.1146 * r - 0.3854 * g + 0.5 * b;
        const v = 0.5 * r - 0.4542 * g - 0.0458 * b;
        vectorPoints.push(u / 128, v / 128, 1.0);
      }

      if (needParade) {
        paradeData.push(r, g, b);
      }
    }
  }

  if (needHistogram) {
    result.histogram = {
      r: histR!,
      g: histG!,
      b: histB!,
      luma: histLuma!,
    };
    transferList.push(histR!.buffer, histG!.buffer, histB!.buffer, histLuma!.buffer);
  }

  if (needVectorscope) {
    const arr = new Float32Array(vectorPoints);
    result.vectorscope = arr;
    transferList.push(arr.buffer);
  }

  if (needParade) {
    const arr = new Float32Array(paradeData);
    result.parade = arr;
    transferList.push(arr.buffer);
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
// Message Router
// ═══════════════════════════════════════════════════════════════════════════════

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      // Audio Waveform LOD
      case "BUILD_LOD":
        handleWaveformBuild(msg as WaveformBuildRequest);
        break;
      case "SLICE_VIEWPORT":
        handleWaveformSlice(msg as WaveformSliceRequest);
        break;
      case "EVICT":
        pyramids.delete((msg as WaveformEvictRequest).mediaId);
        break;

      // Video Color Scopes
      case "ANALYZE":
        handleColorScopeAnalyze(msg as ScopeAnalyzeRequest);
        break;

      // Subtitles & Transcripts
      case "PARSE_SUBTITLES":
        handleSubtitleParse(msg as ParseSubtitlesRequest);
        break;

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
