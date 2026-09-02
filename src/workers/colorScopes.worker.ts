/**
 * ColorScopesWorker — Off-Thread Video Scope & Telemetry Analysis
 *
 * Receives an ImageBitmap transferred zero-copy from the render pipeline and
 * calculates video telemetry without blocking the UI or compositor:
 * • Histogram (256 bins for R, G, B, Luma)
 * • Vectorscope (Rec.709 U/V chromaticity distribution)
 * • Waveform Monitor (Per-column luminance distribution)
 * • RGB Parade (Per-column separated R/G/B distribution)
 */

import type {
  ColorScopesWorkerRequest,
  ScopeAnalyzeRequest,
  ScopeAnalyzeResult,
  WorkerErrorResponse,
} from "./types";

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

function getContext(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!offscreenCtx) throw new Error("OffscreenCanvas 2D context not available");
  return offscreenCtx;
}

function handleAnalyze(msg: ScopeAnalyzeRequest): void {
  const startMs = performance.now();
  const { id, frame, enabledScopes, downsampleFactor = 2 } = msg;

  const width = frame.width;
  const height = frame.height;
  const stride = Math.max(1, Math.round(downsampleFactor));

  const ctx = getContext(width, height);
  ctx.drawImage(frame, 0, 0);

  // Close the transferred ImageBitmap now that it has been drawn to release memory
  try {
    frame.close();
  } catch {
    // Already closed or not supported
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
  const needWaveform = enabledScopes.includes("waveform");
  const needParade = enabledScopes.includes("parade");

  let rHist: Uint32Array | undefined;
  let gHist: Uint32Array | undefined;
  let bHist: Uint32Array | undefined;
  let lumaHist: Uint32Array | undefined;

  if (needHistogram) {
    rHist = new Uint32Array(256);
    gHist = new Uint32Array(256);
    bHist = new Uint32Array(256);
    lumaHist = new Uint32Array(256);
  }

  // Pre-allocate vectorscope buffer if needed
  const sampledCols = Math.ceil(width / stride);
  const sampledRows = Math.ceil(height / stride);
  const totalSampledPixels = sampledCols * sampledRows;

  let vecArray: Float32Array | undefined;
  let vecIdx = 0;
  if (needVectorscope) {
    vecArray = new Float32Array(totalSampledPixels * 3);
  }

  let wfArray: Float32Array | undefined;
  let wfIdx = 0;
  if (needWaveform) {
    wfArray = new Float32Array(totalSampledPixels * 2);
  }

  let paradeArray: Float32Array | undefined;
  let paradeIdx = 0;
  if (needParade) {
    paradeArray = new Float32Array(totalSampledPixels * 4);
  }

  for (let y = 0; y < height; y += stride) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += stride) {
      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // ITU-R BT.709 Luma coefficients
      const luma = Math.min(
        255,
        Math.max(0, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)),
      );

      if (needHistogram && rHist && gHist && bHist && lumaHist) {
        rHist[r]++;
        gHist[g]++;
        bHist[b]++;
        lumaHist[luma]++;
      }

      if (needVectorscope && vecArray) {
        // Rec.709 UV Chromaticity
        const rf = r / 255;
        const gf = g / 255;
        const bf = b / 255;
        const u = -0.09991 * rf - 0.33609 * gf + 0.436 * bf;
        const v = 0.615 * rf - 0.55861 * gf - 0.05639 * bf;
        vecArray[vecIdx++] = u;
        vecArray[vecIdx++] = v;
        vecArray[vecIdx++] = 1.0;
      }

      const colNorm = x / width;

      if (needWaveform && wfArray) {
        wfArray[wfIdx++] = colNorm;
        wfArray[wfIdx++] = luma / 255;
      }

      if (needParade && paradeArray) {
        paradeArray[paradeIdx++] = colNorm;
        paradeArray[paradeIdx++] = r / 255;
        paradeArray[paradeIdx++] = g / 255;
        paradeArray[paradeIdx++] = b / 255;
      }
    }
  }

  if (needHistogram && rHist && gHist && bHist && lumaHist) {
    result.histogram = {
      r: rHist,
      g: gHist,
      b: bHist,
      luma: lumaHist,
    };
    transferList.push(
      rHist.buffer,
      gHist.buffer,
      bHist.buffer,
      lumaHist.buffer,
    );
  }

  if (needVectorscope && vecArray) {
    const finalVec = vecIdx === vecArray.length ? vecArray : vecArray.subarray(0, vecIdx);
    result.vectorscope = finalVec;
    transferList.push(finalVec.buffer);
  }

  if (needWaveform && wfArray) {
    const finalWf = wfIdx === wfArray.length ? wfArray : wfArray.subarray(0, wfIdx);
    result.waveformLines = finalWf;
    transferList.push(finalWf.buffer);
  }

  if (needParade && paradeArray) {
    const finalParade = paradeIdx === paradeArray.length ? paradeArray : paradeArray.subarray(0, paradeIdx);
    result.parade = finalParade;
    transferList.push(finalParade.buffer);
  }

  result.analysisMs = performance.now() - startMs;

  (self as unknown as Worker).postMessage(result, transferList);
}

// ─── Worker Event Listener ───────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<ColorScopesWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      case "ANALYZE":
        handleAnalyze(msg);
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
