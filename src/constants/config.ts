export const VIDEO_CONFIG = {
  FPS: 30,
  DEFAULT_TRIM_DURATION: 8,
  FILMSTRIP: {
    MIN_FRAMES: 18,
    MAX_FRAMES: 72,
    CELL_WIDTH: 92,
    CELL_HEIGHT: 76,
  },
  WAVEFORM: {
    SAMPLE_RATE: 8000,
    MIN_BUCKETS: 32,
    MAX_BUCKETS: 512,
    DEFAULT_BUCKETS: 512,
  },
  ZOOM: {
    MIN_PX_PER_SEC: 16,
    MAX_PX_PER_SEC: 320,
    DEFAULT_PX_PER_SEC: 72,
  },
};

export const SUPPORTED_VIDEO_FORMATS = ["mp4", "mov", "webm", "mkv", "m4v", "avi"];
