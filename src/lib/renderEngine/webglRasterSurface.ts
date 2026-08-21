/**
 * WebGL RasterSurface
 *
 * GPU-accelerated filmstrip renderer.
 * Uploads all artifact bitmaps into a single RGBA texture atlas per epoch,
 * then issues ONE drawArrays() call to render the entire strip.
 *
 * Invariants:
 *   - `NEAREST` sampling — zero browser resampling (matches Canvas2D imageSmoothingEnabled=false)
 *   - Straight alpha — no premul (matches Rust output)
 *   - Falls back to Canvas2D RasterSurface if WebGL2 is unavailable
 *
 * Factory:
 *   import { createRasterSurface } from './rasterSurface';
 *   const surface = createRasterSurface(canvasEl);
 */

import { RasterSurface, type FilmstripLayout } from "./rasterSurface";
import type { TransportArtifact } from "./transport";
import { getFilmstripTileSlots } from "../filmstrip/filmstripLayout";

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */ `#version 300 es
precision mediump float;

in vec2 a_pos;
in vec2 a_uv;

out vec2 v_uv;

void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const FRAG_SRC = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_atlas, v_uv);
}
`;

// ─── Atlas layout ─────────────────────────────────────────────────────────────

/** Packs bitmaps into a square-ish power-of-two atlas texture. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

interface AtlasCell {
  u: number;
  v: number;
  uw: number;
  vh: number;
}

function isValidArtifact(artifact: TransportArtifact): boolean {
  return !!artifact.bitmap && artifact.bitmap.width > 0 && artifact.bitmap.height > 0;
}

function packAtlas(artifacts: readonly TransportArtifact[], cols: number): { atlasW: number; atlasH: number; cellW: number; cellH: number; cells: AtlasCell[] } {
  if (artifacts.length === 0) return { atlasW: 1, atlasH: 1, cellW: 1, cellH: 1, cells: [] };

  const cellW = Math.max(...artifacts.map((artifact) => artifact.width));
  const cellH = Math.max(...artifacts.map((artifact) => artifact.height));
  const rows = Math.ceil(artifacts.length / cols);
  const atlasW = nextPow2(cols * cellW);
  const atlasH = nextPow2(rows * cellH);

  const cells: AtlasCell[] = artifacts.map((artifact, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      u: (col * cellW) / atlasW,
      v: (row * cellH) / atlasH,
      uw: artifact.width / atlasW,
      vh: artifact.height / atlasH,
    };
  });

  return { atlasW, atlasH, cellW, cellH, cells };
}

// ─── WebGLRasterSurface ───────────────────────────────────────────────────────

export class WebGLRasterSurface {
  private _canvas: HTMLCanvasElement;
  private _gl: WebGL2RenderingContext;
  private _program: WebGLProgram;
  private _vao: WebGLVertexArrayObject;
  private _vbo: WebGLBuffer;
  private _atlasTexture: WebGLTexture;
  private _disposed = false;

  // Attribute locations
  private _aPos: number;
  private _aUv: number;

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this._canvas = canvas;
    this._gl = gl;

    this._program = this._compileProgram();
    this._aPos = gl.getAttribLocation(this._program, "a_pos");
    this._aUv = gl.getAttribLocation(this._program, "a_uv");

    if (this._aPos < 0 || this._aUv < 0) {
      throw new Error("[WebGLRasterSurface] Required shader attributes were optimized out");
    }

    this._vao = gl.createVertexArray()!;
    this._vbo = gl.createBuffer()!;
    this._atlasTexture = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ── Shader compilation ──────────────────────────────────────────────────────

  private _compileProgram(): WebGLProgram {
    const gl = this._gl;
    const vert = this._compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = this._compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`[WebGLRasterSurface] Link error: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return prog;
  }

  private _compileShader(type: number, src: string): WebGLShader {
    const gl = this._gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`[WebGLRasterSurface] Shader error: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  drawFilmstrip(artifacts: readonly TransportArtifact[], layout: FilmstripLayout): void {
    const validArtifacts = artifacts.filter(isValidArtifact);
    if (this._disposed || validArtifacts.length === 0) {
      this._clear(layout);
      return;
    }

    const gl = this._gl;
    const { clipWidthPx, stripHeightPx, dpr, tileWidthPx: targetTileW = 60 } = layout;

    const safeClipWidth = Number.isFinite(clipWidthPx) && clipWidthPx > 0 ? clipWidthPx : 1;
    const safeStripHeight = Number.isFinite(stripHeightPx) && stripHeightPx > 0 ? stripHeightPx : 1;
    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

    const backingW = Math.max(1, Math.round(safeClipWidth * safeDpr));
    const backingH = Math.max(1, Math.round(safeStripHeight * safeDpr));

    if (this._canvas.width !== backingW || this._canvas.height !== backingH) {
      this._canvas.width = backingW;
      this._canvas.height = backingH;
    }

    gl.viewport(0, 0, backingW, backingH);
    gl.clearColor(0.047, 0.153, 0.188, 1.0); // #0c2730
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ── Upload atlas ────────────────────────────────────────────────────────
    const cols = Math.min(validArtifacts.length, 16); // max 16 per row
    const { atlasW, atlasH, cellW, cellH, cells } = packAtlas(validArtifacts, cols);

    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
    // Allocate atlas
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasW, atlasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const errAlloc = gl.getError();
    if (errAlloc !== gl.NO_ERROR) {
      console.error(`[WebGLRasterSurface DEBUG] gl.texImage2D error: ${errAlloc}`);
    }

    // Upload each bitmap into its atlas cell
    for (let i = 0; i < validArtifacts.length; i++) {
      const art = validArtifacts[i];
      try {
        const col = i % cols;
        const row = Math.floor(i / cols);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, col * cellW, row * cellH, gl.RGBA, gl.UNSIGNED_BYTE, art.bitmap);
      } catch (e) {
        console.warn(`[WebGLRasterSurface] Failed to upload bitmap at index ${i}:`, e);
      }
    }

    // ── Build per-tile geometry ─────────────────────────────────────────────
    // Destination rects are native bitmap pixel crops clipped into fixed tile
    // slots. This avoids stretching low-resolution artifacts across the slot.
    const FLOATS_PER_VERTEX = 4;
    const VERTS_PER_TILE = 6;
    const tileH = backingH;
    const rects: Array<{ pos: [number, number, number, number]; uv: [number, number, number, number] }> = [];

    const drawSlots: Array<{ art: TransportArtifact; cell: AtlasCell; tileX: number; tileW: number }> = [];
    if (layout.tileAddresses && layout.trimIn !== undefined && layout.trimOut !== undefined) {
      const artifactByTimestamp = new Map<number, { art: TransportArtifact; cell: AtlasCell }>();
      for (let i = 0; i < validArtifacts.length; i++) {
        artifactByTimestamp.set(Math.round(validArtifacts[i].timestampMs), { art: validArtifacts[i], cell: cells[i] });
      }
      const slots = getFilmstripTileSlots({
        addresses: layout.tileAddresses,
        clipWidthPx: safeClipWidth,
        trimIn: layout.trimIn,
        trimOut: layout.trimOut,
        tileWidthPx: targetTileW,
      });
      for (const slot of slots) {
        const match = artifactByTimestamp.get(Math.round(slot.address.timestamp * 1000));
        if (!match) continue;
        drawSlots.push({
          ...match,
          tileX: Math.round(slot.leftPx * safeDpr),
          tileW: Math.max(1, Math.round(slot.widthPx * safeDpr)),
        });
      }
    } else {
      const tileCount = Math.max(1, Math.ceil(safeClipWidth / targetTileW));
      const tileW = Math.round(targetTileW * safeDpr);
      for (let i = 0; i < Math.min(tileCount, validArtifacts.length); i++) {
        drawSlots.push({ art: validArtifacts[i], cell: cells[i], tileX: i * tileW, tileW });
      }
    }

    for (const { art, cell, tileX, tileW } of drawSlots) {

      // Center-crop: scale bitmap to cover tile, then crop to fit
      const bmpAspect = art.width / art.height;
      const tileAspect = tileW / tileH;

      let drawW: number, drawH: number, drawX: number, drawY: number;

      if (bmpAspect > tileAspect) {
        // Bitmap is wider - fit height, crop width
        drawH = tileH;
        drawW = Math.round(drawH * bmpAspect);
        drawX = tileX - Math.round((drawW - tileW) / 2);
        drawY = 0;
      } else {
        // Bitmap is taller - fit width, crop height
        drawW = tileW;
        drawH = Math.round(drawW / bmpAspect);
        drawX = tileX;
        drawY = Math.round((tileH - drawH) / 2);
      }

      // Clip to tile boundaries
      const left = Math.max(tileX, drawX, 0);
      const top = Math.max(0, drawY);
      const right = Math.min(tileX + tileW, drawX + drawW, backingW);
      const bottom = Math.min(tileH, drawY + drawH, backingH);
      const dstW = right - left;
      const dstH = bottom - top;
      if (dstW <= 0 || dstH <= 0) continue;

      // Calculate source UV coordinates for the visible portion
      const srcX = left - drawX;
      const srcY = top - drawY;
      const srcW = dstW;
      const srcH = dstH;

      // Map source pixels to atlas UV space
      const u0 = cell.u + (srcX / drawW) * cell.uw;
      const v0 = cell.v + (srcY / drawH) * cell.vh;
      const uw = (srcW / drawW) * cell.uw;
      const vh = (srcH / drawH) * cell.vh;

      rects.push({
        pos: [(left / backingW) * 2 - 1, 1 - (top / backingH) * 2, (dstW / backingW) * 2, (dstH / backingH) * 2],
        uv: [u0, v0, uw, vh],
      });
    }

    const buf = new Float32Array(rects.length * VERTS_PER_TILE * FLOATS_PER_VERTEX);

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const x0 = rect.pos[0];
      const y0 = rect.pos[1];
      const x1 = rect.pos[0] + rect.pos[2];
      const y1 = rect.pos[1] - rect.pos[3];

      const u0 = rect.uv[0];
      const v0 = rect.uv[1];
      const u1 = rect.uv[0] + rect.uv[2];
      const v1 = rect.uv[1] + rect.uv[3];

      // Triangle 1: TL, BL, TR (Counter-Clockwise)
      // TL (v=0)
      let off = (i * VERTS_PER_TILE + 0) * FLOATS_PER_VERTEX;
      buf[off + 0] = x0;
      buf[off + 1] = y0;
      buf[off + 2] = u0;
      buf[off + 3] = v0;

      // BL (v=1)
      off = (i * VERTS_PER_TILE + 1) * FLOATS_PER_VERTEX;
      buf[off + 0] = x0;
      buf[off + 1] = y1;
      buf[off + 2] = u0;
      buf[off + 3] = v1;

      // TR (v=2)
      off = (i * VERTS_PER_TILE + 2) * FLOATS_PER_VERTEX;
      buf[off + 0] = x1;
      buf[off + 1] = y0;
      buf[off + 2] = u1;
      buf[off + 3] = v0;

      // Triangle 2: TR, BL, BR (Counter-Clockwise)
      // TR (v=3)
      off = (i * VERTS_PER_TILE + 3) * FLOATS_PER_VERTEX;
      buf[off + 0] = x1;
      buf[off + 1] = y0;
      buf[off + 2] = u1;
      buf[off + 3] = v0;

      // BL (v=4)
      off = (i * VERTS_PER_TILE + 4) * FLOATS_PER_VERTEX;
      buf[off + 0] = x0;
      buf[off + 1] = y1;
      buf[off + 2] = u0;
      buf[off + 3] = v1;

      // BR (v=5)
      off = (i * VERTS_PER_TILE + 5) * FLOATS_PER_VERTEX;
      buf[off + 0] = x1;
      buf[off + 1] = y1;
      buf[off + 2] = u1;
      buf[off + 3] = v1;
    }

    // ── Upload VBO and draw ─────────────────────────────────────────────────
    gl.useProgram(this._program);
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(this._aPos);
    gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this._aUv);
    gl.vertexAttribPointer(this._aUv, 2, gl.FLOAT, false, stride, 2 * 4);

    gl.uniform1i(gl.getUniformLocation(this._program, "u_atlas"), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);

    // Single draw call for ALL tiles
    gl.drawArrays(gl.TRIANGLES, 0, rects.length * VERTS_PER_TILE);
    const errDraw = gl.getError();
    if (errDraw !== gl.NO_ERROR) {
      console.error(`[WebGLRasterSurface DEBUG] gl.drawArrays error: ${errDraw}`);
    }

    gl.bindVertexArray(null);
  }

  drawPlaceholder(layout: FilmstripLayout): void {
    this._clear(layout);
  }

  private _clear(layout: FilmstripLayout): void {
    const gl = this._gl;
    const { clipWidthPx, stripHeightPx, dpr } = layout;
    const safeClipWidth = Number.isFinite(clipWidthPx) && clipWidthPx > 0 ? clipWidthPx : 1;
    const safeStripHeight = Number.isFinite(stripHeightPx) && stripHeightPx > 0 ? stripHeightPx : 1;
    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

    const w = Math.max(1, Math.round(safeClipWidth * safeDpr));
    const h = Math.max(1, Math.round(safeStripHeight * safeDpr));
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.047, 0.153, 0.188, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const gl = this._gl;
    gl.deleteTexture(this._atlasTexture);
    gl.deleteBuffer(this._vbo);
    gl.deleteVertexArray(this._vao);
    gl.deleteProgram(this._program);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type AnyRasterSurface = RasterSurface | WebGLRasterSurface;

/**
 * Create the best available raster surface for a canvas element.
 *
 * - Tries WebGL2 first (single draw call, GPU atlas upload)
 * - Falls back to Canvas2D `RasterSurface` if WebGL2 is unavailable
 *
 * ClipFilmstrip usage:
 *   surfaceRef.current = createRasterSurface(canvasRef.current);
 */
export function createRasterSurface(canvas: HTMLCanvasElement): AnyRasterSurface {
  try {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      desynchronized: true,
      antialias: false,
      powerPreference: "default",
    });
    if (gl) {
      return new WebGLRasterSurface(canvas, gl);
    }
  } catch (error) {
    // WebGL context creation can throw in some sandboxed environments
  }
  return new RasterSurface(canvas);
}
