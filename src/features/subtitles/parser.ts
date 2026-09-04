export interface SubtitleBlock {
  id: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
}

/**
 * Parses time string in HH:MM:SS,mmm or HH:MM:SS.mmm format to seconds.
 */
export function parseSubtitleTime(timeStr: string): number {
  const parts = timeStr.trim().replace(",", ".").split(":");
  if (parts.length < 2) return 0;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = parseFloat(parts[0]) || 0;
    minutes = parseFloat(parts[1]) || 0;
    seconds = parseFloat(parts[2]) || 0;
  } else {
    minutes = parseFloat(parts[0]) || 0;
    seconds = parseFloat(parts[1]) || 0;
  }

  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

/**
 * Formats seconds into SRT/VTT time string.
 * @param seconds - time in seconds
 * @param format - 'srt' uses comma, 'vtt' uses dot
 */
export function formatSubtitleTime(seconds: number, format: "srt" | "vtt" = "srt"): string {
  if (!Number.isFinite(seconds) || seconds < 0 || isNaN(seconds)) {
    seconds = 0;
  }
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

  const pad = (num: number, size = 2) => num.toString().padStart(size, "0");

  const separator = format === "srt" ? "," : ".";
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}${separator}${pad(ms, 3)}`;
}

/**
 * Parses SRT or WebVTT content into SubtitleBlocks.
 */
export function parseSubtitles(content: string): SubtitleBlock[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const blocks: SubtitleBlock[] = [];

  // Determine if it's WebVTT
  const isVtt = normalized.startsWith("WEBVTT");

  // Split by double newlines to isolate blocks
  const rawBlocks = normalized.split(/\n\n+/);

  let idCounter = 1;

  for (const block of rawBlocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    // Skip WebVTT header blocks
    if (lines[0].startsWith("WEBVTT") || lines[0].startsWith("STYLE") || lines[0].startsWith("NOTE")) {
      continue;
    }

    let timeLineIndex = 0;
    let customId = "";

    // If first line doesn't contain Arrow (-->), it could be a sequence ID
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

    const startTime = parseSubtitleTime(startPart);
    const endTime = parseSubtitleTime(endPart.trim().split(" ")[0]); // Clean optional VTT positioning coordinates

    // Join text lines after timeLine
    const textLines = lines.slice(timeLineIndex + 1);
    const text = textLines
      .join("\n")
      .replace(/<[^>]*>/g, "") // Clean HTML/VTT style tags
      .trim();

    if (text) {
      blocks.push({
        id: customId || String(idCounter++),
        startTime,
        endTime,
        text,
      });
    }
  }

  return blocks;
}

/**
 * Serializes SubtitleBlocks into SRT or WebVTT string format.
 */
export function serializeSubtitles(blocks: SubtitleBlock[], format: "srt" | "vtt" = "srt"): string {
  const result: string[] = [];

  if (format === "vtt") {
    result.push("WEBVTT\n");
  }

  const sorted = [...blocks].sort((a, b) => a.startTime - b.startTime);

  sorted.forEach((block, index) => {
    const seqId = index + 1;
    const startStr = formatSubtitleTime(block.startTime, format);
    const endStr = formatSubtitleTime(block.endTime, format);

    if (format === "srt") {
      result.push(`${seqId}`);
    } else {
      result.push(`${block.id || seqId}`);
    }

    result.push(`${startStr} --> ${endStr}`);
    result.push(`${block.text}\n`);
  });

  return result.join("\n");
}

/**
 * Asynchronously parses SRT or WebVTT content off the main UI thread via SubtitleParserWorkerClient.
 */
export async function parseSubtitlesAsync(
  content: string,
  format?: "srt" | "vtt",
): Promise<SubtitleBlock[]> {
  const isVtt = format ? format === "vtt" : content.trim().startsWith("WEBVTT");
  const { getSubtitleParserWorkerClient } = await import(
    "@/core/workers/subtitleParserWorkerClient"
  );
  const res = await getSubtitleParserWorkerClient().parseSubtitles(
    isVtt ? "vtt" : "srt",
    content,
  );
  return res.cues.map((cue, idx) => ({
    id: cue.id || String(idx + 1),
    startTime: cue.startTime,
    endTime: cue.endTime,
    text: cue.text,
  }));
}
