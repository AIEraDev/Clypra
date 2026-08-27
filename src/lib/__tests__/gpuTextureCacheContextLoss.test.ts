import { describe, it, expect, vi } from "vitest";
import { GPUTextureCache } from "../cache/gpuTextureCache";

function createMockGL(): WebGL2RenderingContext & { setContextLost: (lost: boolean) => void } {
  let contextLostState = false;

  return {
    canvas: { width: 1920, height: 1080 } as HTMLCanvasElement,
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    COLOR_BUFFER_BIT: 0x00004000,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,

    isContextLost: vi.fn(() => contextLostState),
    setContextLost: (lost: boolean) => {
      contextLostState = lost;
    },
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    createTexture: vi.fn(() => ({ id: Math.random() })),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    createShader: vi.fn(() => ({ id: 1 })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => ({ id: 1 })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    getUniformLocation: vi.fn(() => ({ id: 1 })),
    createBuffer: vi.fn(() => ({ id: 1 })),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawArrays: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
  } as unknown as WebGL2RenderingContext & { setContextLost: (lost: boolean) => void };
}

function createMockCanvas(gl: WebGL2RenderingContext) {
  const listeners: Record<string, ((e: Event) => void)[]> = {};

  return {
    width: 1920,
    height: 1080,
    getContext: vi.fn((type: string) => {
      if (type === "webgl2") return gl;
      return null;
    }),
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
  } as unknown as HTMLCanvasElement & {
    dispatchEvent: (event: string, eventObj?: Partial<Event>) => Event;
  };
}

describe("GPUTextureCache GPU Context Loss & Recovery", () => {
  it("registers webglcontextlost and webglcontextrestored listeners on canvas", () => {
    const gl = createMockGL();
    const canvas = createMockCanvas(gl);
    const cache = new GPUTextureCache(canvas, 64);

    expect(canvas.addEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(canvas.addEventListener).toHaveBeenCalledWith("webglcontextrestored", expect.any(Function));
  });

  it("calls preventDefault() and purges texture maps when context is lost", () => {
    const gl = createMockGL();
    const canvas = createMockCanvas(gl);
    const cache = new GPUTextureCache(canvas, 64);

    cache.uploadTexture("t1", new Uint8Array(100 * 100 * 4), 100, 100);
    expect(cache.hasTexture("t1")).toBe(true);
    expect(cache.getMemoryUsageMB()).toBeGreaterThan(0);

    const event = canvas.dispatchEvent("webglcontextlost");

    expect(event.preventDefault).toHaveBeenCalled();
    expect(cache.hasTexture("t1")).toBe(false);
    expect(cache.getMemoryUsageMB()).toBe(0);
  });

  it("safely guards uploadTexture and renderTexture during lost context without throwing", () => {
    const gl = createMockGL();
    const canvas = createMockCanvas(gl);
    const cache = new GPUTextureCache(canvas, 64);

    canvas.dispatchEvent("webglcontextlost");

    const key = cache.uploadTexture("t2", new Uint8Array(100 * 100 * 4), 100, 100);
    expect(key).toBe("t2");
    expect(cache.hasTexture("t2")).toBe(false);

    expect(() => {
      cache.renderTexture("t2", 0, 0, 100, 100);
    }).not.toThrow();
  });

  it("re-initializes shaders and buffers when context is restored", () => {
    const gl = createMockGL();
    const canvas = createMockCanvas(gl);
    const cache = new GPUTextureCache(canvas, 64);

    canvas.dispatchEvent("webglcontextlost");

    const createProgSpy = vi.spyOn(gl, "createProgram");
    const createBufSpy = vi.spyOn(gl, "createBuffer");

    canvas.dispatchEvent("webglcontextrestored");

    expect(createProgSpy).toHaveBeenCalled();
    expect(createBufSpy).toHaveBeenCalled();

    // Should allow uploads again
    cache.uploadTexture("t3", new Uint8Array(50 * 50 * 4), 50, 50);
    expect(cache.hasTexture("t3")).toBe(true);
  });

  it("cleans up event listeners upon dispose", () => {
    const gl = createMockGL();
    const canvas = createMockCanvas(gl);
    const cache = new GPUTextureCache(canvas, 64);

    cache.dispose();

    expect(canvas.removeEventListener).toHaveBeenCalledWith("webglcontextlost", expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith("webglcontextrestored", expect.any(Function));
  });
});
