import React, {
  useEffect, useRef, useImperativeHandle,
  forwardRef, useState, useMemo
} from 'react';
import { renderTextTemplateToCanvas, resolveTextTemplateArtifact } from '@clypra-studio/engine';
import { getApiBaseUrl } from '@/lib/api';
import { getFontLoader } from '@/core/fonts/FontLoader';

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
    const artifact = useMemo(() => resolveTextTemplateArtifact(template), [template]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const [isPlaying, setIsPlaying] = useState(autoplay);
    const [currentTime, setCurrentTime] = useState(0);
    const [fontsReady, setFontsReady] = useState(!artifact);

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

    // Canvas does not inherit loaded CSS fonts automatically. Load all
    // authored template fonts before its first text measurement/draw.
    useEffect(() => {
      let cancelled = false;
      const textNodes = artifact?.document.nodes.filter((node: any) => node.type === 'text') ?? [];
      const descriptors = textNodes
        .map((node: any) => ({
          family: node.style?.fontFamily,
          weight: node.style?.fontWeight ?? 400,
          style: 'normal' as const,
        }))
        .filter((descriptor) => typeof descriptor.family === 'string' && descriptor.family.trim());

      setFontsReady(descriptors.length === 0);
      if (descriptors.length === 0) return () => { cancelled = true; };

      getFontLoader().ensureFonts(descriptors).then(async () => {
        await getFontLoader().waitForFontsReady();
        if (!cancelled) setFontsReady(true);
      }).catch((error) => {
        console.warn('[TemplatePreviewPlayer] Font loading failed; using fallback fonts:', error);
        if (!cancelled) setFontsReady(true);
      });

      return () => { cancelled = true; };
    }, [artifact]);

    const resolvedMode = mode !== "auto"
      ? mode
      : (artifact || (template && (template.layers || template.assets || template.animation)))
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
          const fps = artifact?.timing.fps || template.fps || 30;
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
        totalFrames: artifact ? Math.round(artifact.timing.duration * artifact.timing.fps) : template ? Math.round((template.duration || 4) * (template.fps || 30)) : 0,
        frameRate: artifact?.timing.fps || template?.fps || 30,
        isLoaded: !!artifact || !!template,
      }),
    }));

    // Trigger ready callback on mount if data is present
    useEffect(() => {
      if (template && (resolvedMode === "canvas" ? fontsReady : videoRef.current)) {
        onReadyRef.current?.();
      }
    }, [template, resolvedMode, fontsReady]);

    // ==========================================
    // CANVAS MODE EFFECTS
    // ==========================================
    useEffect(() => {
      if (resolvedMode !== "canvas" || !template || !canvasRef.current) return;
      if (!fontsReady) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = artifact?.document.canvas.width || template.canvasWidth || template.width || 800;
      const height = artifact?.document.canvas.height || template.canvasHeight || template.height || 600;
      canvas.width = width;
      canvas.height = height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (artifact) {
        renderTextTemplateToCanvas(ctx, {
          artifact,
          context: {
            environment: "preview",
            time: currentTime,
            width,
            height,
          },
        });
      }

      // Fire frame updates
      const fps = artifact?.timing.fps || template.fps || 30;
      const totalFrames = Math.round((artifact?.timing.duration || template.duration || 4) * fps);
      const currentFrame = Math.round(currentTime * fps);
      onFrameChangeRef.current?.(currentFrame, totalFrames);
    }, [resolvedMode, template, currentTime, fitToContent, fontsReady]);

    const tick = (timestamp: number) => {
      if (previousTimeRef.current !== null && template) {
        const elapsed = (timestamp - previousTimeRef.current) / 1000;
        const nextTime = currentTime + elapsed * speed;
        
        if (nextTime >= (artifact?.timing.duration || template.duration || 4)) {
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
        const fps = artifact?.timing.fps || template.fps || 30;
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
        const fps = artifact?.timing.fps || template.fps || 30;
        videoRef.current.currentTime = initialFrame / fps;
      }
    }, [resolvedMode, template, initialFrame]);

    if (!template) {
      return (
        <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666677', fontSize: 12 }}>
          No template loaded
        </div>
      );
    }

    if (resolvedMode === "canvas") {
      if (!artifact) {
        return (
          <div className={className} style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fca5a5', fontSize: 12, textAlign: 'center', padding: 16 }}>
            Template preview data is unavailable. Reload this template to fetch its renderable revision.
          </div>
        );
      }
      return (
        <div className={className} style={{ position: 'relative', width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <canvas
            ref={canvasRef}
            width={artifact?.document.canvas.width || template.canvasWidth || template.width || 800}
            height={artifact?.document.canvas.height || template.canvasHeight || template.height || 600}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      );
    }

  const previewUrl =
      template.preview ||
      `${getApiBaseUrl()}/media/text-templates/${template.category}/${template.id}.webm`;

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
