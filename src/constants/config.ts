export const VIDEO_CONFIG = {
  FPS: 30,
  DEFAULT_TRIM_DURATION: 8,
  FILMSTRIP: {
    MIN_FRAMES: 18,
    MAX_FRAMES: 72,
    CELL_WIDTH: 92,
    CELL_HEIGHT: 76,
    JPEG_QUALITY: 0.8,
  },
  WAVEFORM: {
    SAMPLE_RATE: 8000,
    MIN_BUCKETS: 32,
    MAX_BUCKETS: 512,
    DEFAULT_BUCKETS: 512,
  },
  ZOOM: {
    // Discrete zoom levels (0-11) - indices into ZOOM_LEVELS
    ZOOM_LEVEL_COUNT: 12,
    DEFAULT_ZOOM_INDEX: 11, // Maximum zoom (5400px/s)
    // Legacy: keep for reference, now use ZOOM_LEVELS from ../features/timeline/types/zoom
    MIN_PX_PER_SEC: 15,
    MAX_PX_PER_SEC: 5400,
  },
};

export const DEFAULT_STILL_DURATION_SECONDS = 5;

export const SUPPORTED_VIDEO_FORMATS = ["mp4", "mov", "webm", "mkv", "m4v", "avi"];
