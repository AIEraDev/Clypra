/**
 * SubtitleParserWorker — Off-Thread Subtitle/Transcript Parsing & Layout Engine
 *
 * Handles:
 * • Multi-format parsing: SRT, WebVTT, ASS (Advanced SubStation Alpha), Whisper word-level segments
 * • Word-level timing segmentation for karaoke and word-highlight effects
 * • Text measurement, word-wrapping, and bounding box layout via OffscreenCanvas
 */

import type {
  SubtitleParserWorkerRequest,
  ParseSubtitlesRequest,
  LayoutCuesRequest,
  ParseResult,
  LayoutResult,
  ParsedCaptionCue,
  LayoutedCaptionCue,
  WhisperWordSegment,
  WorkerErrorResponse,
} from "./types";

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

function getContext(): OffscreenCanvasRenderingContext2D {
  if (!offscreenCanvas) {
    offscreenCanvas = new OffscreenCanvas(800, 200);
    offscreenCtx = offscreenCanvas.getContext("2d");
  }
  if (!offscreenCtx) throw new Error("OffscreenCanvas context not available");
  return offscreenCtx;
}

function parseTimecode(str: string): number {
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

    let timeLineIndex = 0;
    let customId = "";

    if (!lines[0].includes("-->")) {
      customId = lines[0].trim();
      timeLineIndex = 1;
    }

    if (timeLineIndex >= lines.length || !lines[timeLineIndex].includes("-->")) {
      continue;
    }

    const timeLine = lines[timeLineIndex];
    const [startPart, endPart] = timeLine.split("-->");
    if (!startPart || !endPart) continue;

    const startTime = parseTimecode(startPart);
    const endTime = parseTimecode(endPart.trim().split(" ")[0]);

    const textLines = lines.slice(timeLineIndex + 1);
    const text = textLines
      .join("\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
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

function parseAss(content: string): ParsedCaptionCue[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const cues: ParsedCaptionCue[] = [];
  let inEvents = false;
  let counter = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[Events]")) {
      inEvents = true;
      continue;
    }
    if (!inEvents) continue;

    if (trimmed.startsWith("Dialogue:")) {
      const payload = trimmed.substring("Dialogue:".length).trim();
      const parts = payload.split(",");
      if (parts.length >= 10) {
        const startStr = parts[1].trim();
        const endStr = parts[2].trim();
        const rawText = parts.slice(9).join(",");

        const startTime = parseTimecode(startStr);
        const endTime = parseTimecode(endStr);
        const cleanText = rawText
          .replace(/\{[^}]*\}/g, "") // remove style override tags like {\b1}
          .replace(/\\N/g, "\n")
          .replace(/\\n/g, "\n")
          .trim();

        if (cleanText) {
          cues.push({
            id: `ass-cue-${counter++}`,
            startTime,
            endTime,
            text: cleanText,
          });
        }
      }
    }
  }

  return cues;
}

function groupWhisperSegments(
  segments: WhisperWordSegment[],
  maxWordsPerCue = 6,
  maxDurationPerCue = 3.0,
): ParsedCaptionCue[] {
  const cues: ParsedCaptionCue[] = [];
  let currentWords: WhisperWordSegment[] = [];
  let cueIndex = 1;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    currentWords.push(seg);

    const cueDuration =
      currentWords[currentWords.length - 1].endTime - currentWords[0].startTime;
    const isPunctuationEnd = /[.!?]$/.test(seg.word.trim());

    if (
      currentWords.length >= maxWordsPerCue ||
      cueDuration >= maxDurationPerCue ||
      isPunctuationEnd ||
      i === segments.length - 1
    ) {
      const text = currentWords.map((w) => w.word.trim()).join(" ");
      const startTime = currentWords[0].startTime;
      const endTime = currentWords[currentWords.length - 1].endTime;

      cues.push({
        id: `whisper-cue-${cueIndex++}`,
        startTime,
        endTime,
        text,
        words: currentWords.map((w) => ({
          word: w.word.trim(),
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      });

      currentWords = [];
    }
  }

  return cues;
}

function handleParseSubtitles(msg: ParseSubtitlesRequest): void {
  const start = performance.now();
  const { id, format, rawText = "", whisperSegments = [] } = msg;

  let cues: ParsedCaptionCue[] = [];

  switch (format) {
    case "srt":
    case "vtt":
      cues = parseSrtOrVtt(rawText);
      break;
    case "ass":
      cues = parseAss(rawText);
      break;
    case "whisper":
      cues = groupWhisperSegments(whisperSegments);
      break;
  }

  let durationSeconds = 0;
  for (const cue of cues) {
    if (cue.endTime > durationSeconds) {
      durationSeconds = cue.endTime;
    }
  }

  const response: ParseResult = {
    type: "PARSE_RESULT",
    id,
    cues,
    durationSeconds,
    parseMs: performance.now() - start,
  };

  (self as unknown as Worker).postMessage(response);
}

function handleLayoutCues(msg: LayoutCuesRequest): void {
  const start = performance.now();
  const {
    id,
    cues,
    fontFamily,
    fontSize,
    canvasWidth,
    canvasHeight,
    maxLineWidthRatio = 0.85,
  } = msg;

  const ctx = getContext();
  ctx.font = `600 ${fontSize}px "${fontFamily}", sans-serif`;

  const maxWidth = canvasWidth * maxLineWidthRatio;
  const lineHeight = fontSize * 1.3;

  const layoutedCues: LayoutedCaptionCue[] = cues.map((cue) => {
    const words = cue.text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    let maxMeasuredLineWidth = 0;
    for (const line of lines) {
      const m = ctx.measureText(line);
      if (m.width > maxMeasuredLineWidth) maxMeasuredLineWidth = m.width;
    }

    const boxWidth = Math.ceil(maxMeasuredLineWidth + 20);
    const boxHeight = Math.ceil(lines.length * lineHeight + 10);
    const boxX = Math.round((canvasWidth - boxWidth) / 2);
    const boxY = Math.round(canvasHeight - boxHeight - canvasHeight * 0.1);

    return {
      ...cue,
      boundingBox: {
        x: boxX,
        y: boxY,
        width: boxWidth,
        height: boxHeight,
      },
    };
  });

  const response: LayoutResult = {
    type: "LAYOUT_RESULT",
    id,
    cues: layoutedCues,
    layoutMs: performance.now() - start,
  };

  (self as unknown as Worker).postMessage(response);
}

// ─── Worker Event Listener ───────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<SubtitleParserWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      case "PARSE_SUBTITLES":
        handleParseSubtitles(msg);
        break;
      case "LAYOUT_CUES":
        handleLayoutCues(msg);
        break;
      case "DISPOSE":
        offscreenCanvas = null;
        offscreenCtx = null;
        break;
    }
  } catch (error) {
    const errorResponse: WorkerErrorResponse = {
      type: "ERROR",
      id: "id" in msg ? msg.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};
