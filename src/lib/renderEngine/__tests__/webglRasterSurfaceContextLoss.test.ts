import { describe, expect, it, vi } from "vitest";
import { WebGLRasterSurface } from "../webglRasterSurface";
import type { TransportArtifact } from "../transport";
import { SpatialTier } from "../types";

function makeArtifact(timestampMs: number, width = 80, height = 45): TransportArtifact {
  return {
    frameId: `f-${timestampMs}`,
    contentHash: `h-${timestampMs}`,
    spatialTier: SpatialTier.L0,
    bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap,
    width,
    height,
    timestampMs,
    epochId: "epoch-1" as any,
    source: "fresh-decode",
  };
}

function makeGl(isContextLost = false) {
  let contextLostState = isContextLost;

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    COLOR_BUFFER_BIT: 0x4000,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    TEXTURE0: 0x84c0,
    TRIANGLES: 0x0004,
    NO_ERROR: 0,
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => contextLostState),
    setContextLost: (lost: boolean) => {
      contextLostState = lost;
    },
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    getAttribLocation: vi.fn((_program: unknown, name: string) => {
      if (name === "a_pos") return 0;
      if (name === "a_uv") return 1;
      return -1;
    }),
    createVertexArray: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    useProgram: vi.fn(),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    uniform1i: vi.fn(),
    activeTexture: vi.fn(),
    drawArrays: vi.fn(),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteProgram: vi.fn(),
  };

  return gl as unknown as WebGL2RenderingContext & { setContextLost: (lost: boolean) => void };
}

function makeMockCanvas() {
  const listeners: Record<string, ((e: Event) => void)[]> = {};

  return {
    width: 0,
    height: 0,
    addEventListener: vi.fn((event: string, cb: (e: Event) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: (e: Event) => void) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((fn) => fn !== cb);
    }),
    dispatchEvent: (event: string, eventObj: Partial<Event> = {}) => {
      const e = { preventDefault: vi.fn(), ...eventObj } as unknown as Event;
      (listeners[event] || []).forEach((cb) => cb(e));
      return e;
    },
    listeners,
  } as unknown as HTMLCanvasElement & {
    dispatchEvent: (event: string, eventObj?: Partial<Event>) => Event;
    listeners: Record<string, ((e: Event) => void)[]>;
  };
}

describe("WebGLRasterSurface GPU Context Loss & Recovery", () => {
  it("registers webglcontextlost and webglcontextrestored listeners on canvas upon initialization", () => {
    const canvas = makeMockCanvas();
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    expect(canvas.addEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(canvas.addEventListener).toHaveBeenCalledWith("webglcontextrestored", expect.any(Function));
    expect(surface.isContextLost).toBe(false);
  });

  it("calls preventDefault() and marks isContextLost=true when webglcontextlost event fires", () => {
    const canvas = makeMockCanvas();
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    const event = canvas.dispatchEvent("webglcontextlost");

    expect(event.preventDefault).toHaveBeenCalled();
    expect(surface.isContextLost).toBe(true);
  });

  it("safely skips drawFilmstrip when context is lost instead of issuing GL calls", () => {
    const canvas = makeMockCanvas();
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    // Trigger context loss
    canvas.dispatchEvent("webglcontextlost");
    gl.drawArrays = vi.fn();

    // Attempt draw
    surface.drawFilmstrip([makeArtifact(1000)], {
      clipWidthPx: 120,
      stripHeightPx: 45,
      dpr: 1,
    });

    expect(gl.drawArrays).not.toHaveBeenCalled();
  });

  it("re-compiles shaders and re-allocates GPU resources when webglcontextrestored fires", () => {
    const canvas = makeMockCanvas();
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    // Lost
    canvas.dispatchEvent("webglcontextlost");
    expect(surface.isContextLost).toBe(true);

    const createProgramSpy = vi.spyOn(gl, "createProgram");
    const createVaoSpy = vi.spyOn(gl, "createVertexArray");
    const createTexSpy = vi.spyOn(gl, "createTexture");

    // Restored
    canvas.dispatchEvent("webglcontextrestored");
    expect(surface.isContextLost).toBe(false);
    expect(createProgramSpy).toHaveBeenCalled();
    expect(createVaoSpy).toHaveBeenCalled();
    expect(createTexSpy).toHaveBeenCalled();
  });

  it("cleans up event listeners upon dispose", () => {
    const canvas = makeMockCanvas();
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    surface.dispose();

    expect(canvas.removeEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith("webglcontextrestored", expect.any(Function));
    expect(surface.isDisposed).toBe(true);
  });

  it("does not attempt to delete GPU resources upon dispose if context is lost", () => {
    const canvas = makeMockCanvas();
    const gl = makeGl();
    const surface = new WebGLRasterSurface(canvas, gl);

    canvas.dispatchEvent("webglcontextlost");

    const deleteTexSpy = vi.spyOn(gl, "deleteTexture");
    const deleteProgSpy = vi.spyOn(gl, "deleteProgram");

    surface.dispose();

    expect(deleteTexSpy).not.toHaveBeenCalled();
    expect(deleteProgSpy).not.toHaveBeenCalled();
  });
});
