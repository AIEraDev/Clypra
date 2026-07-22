import React, {
  useEffect, useRef, useImperativeHandle,
  forwardRef, useState
} from 'react';
import { TemplateRenderer } from '@clypra-studio/engine';
import { t } from '@/i18n';

export interface TemplatePreviewPlayerHandle {
  play:        () => void;
  pause:       () => void;
  stop:        () => void;
  goToFrame:   (frame: number) => void;
  getAnimation: () => any;
}

export interface TemplatePreviewPlayerProps {
  lottieData?:  any | null; // Represents TextTemplate payload
  templateData?: any | null; // Represents TextTemplate payload
  autoplay?:    boolean;
  loop?:        boolean;
  speed?:       number;
  initialFrame?: number;
  width?:       number | string;
  height?:      number | string;
  onReady?:     () => void;
  onComplete?:  () => void;
  onError?:     (error: string) => void;
  className?:   string;
  onFrameChange?: (currentFrame: number, totalFrames: number) => void;
  mode?:        "video" | "canvas" | "auto";
  fitToContent?: boolean;
}

export const TemplatePreviewPlayer = forwardRef<TemplatePreviewPlayerHandle, TemplatePreviewPlayerProps>(
  ({
    lottieData,
    templateData,
    autoplay  = true,
    loop      = true,
    speed     = 1,
    initialFrame,
    width     = '100%',
    height    = '100%',
    onReady,
    onComplete,
    onError,
    className,
    onFrameChange,
    mode      = "auto",
    fitToContent = false,
  }, ref) => {
    const template = templateData || lottieData;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const [isPlaying, setIsPlaying] = useState(autoplay);
    const [currentTime, setCurrentTime] = useState(0);

    const requestRef = useRef<number | null>(null);
    const previousTimeRef = useRef<number | null>(null);

    const onReadyRef = useRef(onReady);
    const onCompleteRef = useRef(onComplete);
    const onFrameChangeRef = useRef(onFrameChange);

    useEffect(() => {
      onReadyRef.current = onReady;
      onCompleteRef.current = onComplete;
      onFrameChangeRef.current = onFrameChange;
    });

    const resolvedMode = mode !== "auto"
      ? mode
      : (template && (template.layers || template.assets || template.animation))
        ? "canvas"
        : "video";

    // Expose Lottie player compatible controller handles
    useImperativeHandle(ref, () => ({
      play: () => {
        setIsPlaying(true);
      },
      pause: () => {
        setIsPlaying(false);
      },
      stop: () => {
        setIsPlaying(false);
        if (resolvedMode === "canvas") {
          setCurrentTime(0);
        } else {
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
          }
        }
      },
      goToFrame: (frame: number) => {
        setIsPlaying(false);
        if (template) {
          const fps = template.fps || 30;
          const targetTime = frame / fps;
          if (resolvedMode === "canvas") {
            setCurrentTime(targetTime);
          } else {
            if (videoRef.current) {
              videoRef.current.currentTime = targetTime;
            }
          }
        }
      },
      getAnimation: () => ({
        totalFrames: template ? Math.round((template.duration || 4) * (template.fps || 30)) : 0,
        frameRate: template?.fps || 30,
        isLoaded: !!template,
      }),
    }));

    // Trigger ready callback on mount if data is present
    useEffect(() => {
      if (template && (resolvedMode === "canvas" || videoRef.current)) {
        onReadyRef.current?.();
      }
    }, [template, resolvedMode]);

    // ==========================================
    // CANVAS MODE EFFECTS
    // ==========================================
    useEffect(() => {
      if (resolvedMode !== "canvas" || !template || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const renderer = new TemplateRenderer(template);
      renderer.drawFrame(ctx, currentTime, fitToContent);

      // Fire frame updates
      const fps = template.fps || 30;
      const totalFrames = Math.round((template.duration || 4) * fps);
      const currentFrame = Math.round(currentTime * fps);
      onFrameChangeRef.current?.(currentFrame, totalFrames);
    }, [resolvedMode, template, currentTime, fitToContent]);

    const tick = (timestamp: number) => {
      if (previousTimeRef.current !== null && template) {
        const elapsed = (timestamp - previousTimeRef.current) / 1000;
        const nextTime = currentTime + elapsed * speed;
        
        if (nextTime >= (template.duration || 4)) {
          if (loop) {
            setCurrentTime(0);
          } else {
            setIsPlaying(false);
            onCompleteRef.current?.();
          }
        } else {
          setCurrentTime(nextTime);
        }
      }
      previousTimeRef.current = timestamp;
      requestRef.current = requestAnimationFrame(tick);
    };

    useEffect(() => {
      if (resolvedMode !== "canvas") return;

      if (isPlaying) {
        previousTimeRef.current = null;
        requestRef.current = requestAnimationFrame(tick);
      } else {
        if (requestRef.current) {
          cancelAnimationFrame(requestRef.current);
        }
      }
      return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
    }, [resolvedMode, isPlaying, currentTime, speed, template]);

    useEffect(() => {
      if (resolvedMode === "canvas" && template && initialFrame !== undefined) {
        const fps = template.fps || 30;
        setCurrentTime(initialFrame / fps);
      }
    }, [resolvedMode, template, initialFrame]);

    // ==========================================
    // VIDEO MODE EFFECTS
    // ==========================================
    useEffect(() => {
      if (resolvedMode !== "video") return;
      const video = videoRef.current;
      if (!video) return;

      if (isPlaying) {
        video.play().catch((err) => {
          console.warn("Video play failed:", err);
        });
      } else {
        video.pause();
      }
    }, [resolvedMode, isPlaying]);

    useEffect(() => {
      if (resolvedMode === "video" && videoRef.current) {
        videoRef.current.playbackRate = speed;
      }
    }, [resolvedMode, speed]);

    useEffect(() => {
      if (resolvedMode === "video" && template && initialFrame !== undefined && videoRef.current) {
        const fps = template.fps || 30;
        videoRef.current.currentTime = initialFrame / fps;
      }
    }, [resolvedMode, template, initialFrame]);

    if (!template) {
      return (
        <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666677', fontSize: 12 }}>
          {t("features.templates.noTemplateLoaded")}
        </div>
      );
    }

    if (resolvedMode === "canvas") {
      return (
        <div className={className} style={{ position: 'relative', width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <canvas
            ref={canvasRef}
            width={template.canvasWidth || template.width || 800}
            height={template.canvasHeight || template.height || 600}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      );
    }

    const previewUrl =
      template.preview ||
      `https://clypra-worker-api.abdulkabirmusa.com/media/text-templates/${template.category}/${template.id}.webm`;

    return (
      <div className={className} style={{ position: 'relative', width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video
          ref={videoRef}
          src={previewUrl}
          loop={loop}
          muted
          playsInline
          preload="auto"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onLoadedData={() => {
            onReadyRef.current?.();
          }}
          onEnded={() => {
            if (!loop) {
              setIsPlaying(false);
              onCompleteRef.current?.();
            }
          }}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (video && template) {
              const fps = template.fps || 30;
              const totalFrames = Math.round((template.duration || 4) * fps);
              const currentFrame = Math.round(video.currentTime * fps);
              onFrameChangeRef.current?.(currentFrame, totalFrames);
            }
          }}
        />
      </div>
    );
  }
);

TemplatePreviewPlayer.displayName = 'TemplatePreviewPlayer';
export default TemplatePreviewPlayer;
