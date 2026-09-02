import React, {
  useEffect, useRef, useImperativeHandle,
  forwardRef, useState, useMemo
} from 'react';
import { renderTextTemplateToCanvas, resolveTextTemplateArtifact } from '@clypra-studio/engine';
import { getApiBaseUrl } from '@/lib/api';
import { getFontLoader } from '@/core/fonts/FontLoader';
import { resolveCanonicalFamily } from '@/core/fonts/fontRegistry';

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

function extractAllTemplateTextNodes(nodes: any[]): any[] {
  const result: any[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      result.push(node);
    }
    if (Array.isArray(node.children)) {
      result.push(...extractAllTemplateTextNodes(node.children));
    }
  }
  return result;
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
      const textNodes = extractAllTemplateTextNodes(artifact?.document.nodes ?? []);
      const descriptors: Array<{ family: string; weight: number; style: 'normal' | 'italic' }> = [];

      for (const node of textNodes) {
        if (node.style?.fontFamily) {
          const rawFamily = String(node.style.fontFamily).trim();
          const weight = typeof node.style.fontWeight === 'number'
            ? node.style.fontWeight
            : Number(node.style.fontWeight) || 400;
          const style = (node.style.fontStyle === 'italic' ? 'italic' : 'normal') as 'normal' | 'italic';
          
          descriptors.push({ family: rawFamily, weight, style });
          const canonical = resolveCanonicalFamily(rawFamily);
          if (canonical && canonical.toLowerCase() !== rawFamily.toLowerCase()) {
            descriptors.push({ family: canonical, weight, style });
          }
        }
      }

      // Also inspect legacy layers if present
      const layers = (template?.layers || template?.elements) as any[];
      if (Array.isArray(layers)) {
        for (const layer of layers) {
          if (layer.kind === 'text' && layer.fontFamily) {
            const rawFamily = String(layer.fontFamily).trim();
            const weight = typeof layer.fontWeight === 'number'
              ? layer.fontWeight
              : Number(layer.fontWeight) || 400;
            const style = (layer.fontStyle === 'italic' ? 'italic' : 'normal') as 'normal' | 'italic';
            
            descriptors.push({ family: rawFamily, weight, style });
            const canonical = resolveCanonicalFamily(rawFamily);
            if (canonical && canonical.toLowerCase() !== rawFamily.toLowerCase()) {
              descriptors.push({ family: canonical, weight, style });
            }
          }
        }
      }

      const validDescriptors = descriptors.filter((d) => Boolean(d.family));

      setFontsReady(validDescriptors.length === 0);
      if (validDescriptors.length === 0) return () => { cancelled = true; };

      getFontLoader().ensureFonts(validDescriptors).then(async () => {
        await getFontLoader().waitForFontsReady();
        if (typeof document !== "undefined" && document.fonts) {
          for (const d of validDescriptors) {
            const face = `${d.style} ${d.weight} 16px "${d.family}"`;
            try {
              await document.fonts.load(face);
            } catch {
              // Ignore individual font load error
            }
          }
          await document.fonts.ready;
        }
        if (!cancelled) setFontsReady(true);
      }).catch((error) => {
        console.warn('[TemplatePreviewPlayer] Font loading failed; using fallback fonts:', error);
        if (!cancelled) setFontsReady(true);
      });

      return () => { cancelled = true; };
    }, [artifact, template]);

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

interface TemplateContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function computeTemplateContentBounds(
  artifact: any,
  template: any,
  ctx?: CanvasRenderingContext2D | null,
): TemplateContentBounds | null {
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];

  // 1. Check artifact nodes
  const nodes = artifact?.document?.nodes;
  if (Array.isArray(nodes) && nodes.length > 0) {
    for (const node of nodes) {
      if (node.type === "text") {
        const text = String(node.text ?? node.content ?? "CLYPRA");
        const style = node.style || {};
        const fontSize = typeof style.fontSize === "number" && Number.isFinite(style.fontSize) ? style.fontSize : 48;
        const lineHeight = typeof style.lineHeight === "number" && Number.isFinite(style.lineHeight) ? style.lineHeight : 1.2;
        const letterSpacing = typeof style.letterSpacing === "number" && Number.isFinite(style.letterSpacing) ? style.letterSpacing : 0;
        const lines = text.split("\n");

        let measuredW = 0;
        if (ctx) {
          ctx.save();
          const weight = style.fontWeight ?? 400;
          const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
          const rawFamily = (style.fontFamily || "Inter Variable").replace(/"/g, "");
          const canonical = resolveCanonicalFamily(rawFamily);
          ctx.font = `${fontStyle} ${weight} ${fontSize}px "${canonical}", "${rawFamily}", sans-serif`;
          const lineWidths = lines.map(
            (line) => ctx.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing,
          );
          measuredW = Math.max(1, ...lineWidths);
          ctx.restore();
        } else {
          measuredW = Math.max(
            1,
            ...lines.map((l) => l.length * fontSize * 0.6 + Math.max(0, l.length - 1) * letterSpacing),
          );
        }
        const measuredH = Math.max(1, lines.length * fontSize * lineHeight);

        const nodeW = typeof node.width === "number" && Number.isFinite(node.width) && node.width > 0 ? node.width : measuredW;
        const nodeH = typeof node.height === "number" && Number.isFinite(node.height) && node.height > 0 ? node.height : measuredH;

        const panel = node.backgroundPanel || node.style?.backgroundPanel || (node.content as any)?.backgroundPanel;
        const padL = Number(panel?.paddingLeft ?? 0);
        const padR = Number(panel?.paddingRight ?? padL);
        const padT = Number(panel?.paddingTop ?? 0);
        const padB = Number(panel?.paddingBottom ?? padT);

        const x = Number(node.x ?? 0) - padL;
        const y = Number(node.y ?? 0) - padT;
        const w = nodeW + padL + padR;
        const h = nodeH + padT + padB;

        boxes.push({ x, y, w, h });
      } else if (node.type === "shape" || node.type === "container" || node.type === "image") {
        const x = Number(node.x ?? 0);
        const y = Number(node.y ?? 0);
        const w = typeof node.width === "number" && Number.isFinite(node.width) ? node.width : 200;
        const h = typeof node.height === "number" && Number.isFinite(node.height) ? node.height : 100;
        boxes.push({ x, y, w, h });
      }
    }
  }

  // 2. Check legacy layers
  const layers = template?.layers || template?.elements;
  if (boxes.length === 0 && Array.isArray(layers) && layers.length > 0) {
    for (const layer of layers) {
      if (layer.kind === "text") {
        const text = String(layer.content ?? layer.text ?? "CLYPRA");
        const fontSize = typeof layer.fontSize === "number" && Number.isFinite(layer.fontSize) ? layer.fontSize : 48;
        const lineHeight = typeof layer.lineHeight === "number" && Number.isFinite(layer.lineHeight) ? layer.lineHeight : 1.2;
        const letterSpacing = typeof layer.letterSpacing === "number" && Number.isFinite(layer.letterSpacing) ? layer.letterSpacing : 0;
        const lines = text.split("\n");

        let measuredW = 0;
        if (ctx) {
          ctx.save();
          const weight = layer.fontWeight ?? 400;
          const fontStyle = layer.fontStyle === "italic" ? "italic" : "normal";
          const rawFamily = (layer.fontFamily || "Inter Variable").replace(/"/g, "");
          const canonical = resolveCanonicalFamily(rawFamily);
          ctx.font = `${fontStyle} ${weight} ${fontSize}px "${canonical}", "${rawFamily}", sans-serif`;
          const lineWidths = lines.map(
            (line) => ctx.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing,
          );
          measuredW = Math.max(1, ...lineWidths);
          ctx.restore();
        } else {
          measuredW = Math.max(
            1,
            ...lines.map((l) => l.length * fontSize * 0.6 + Math.max(0, l.length - 1) * letterSpacing),
          );
        }
        const measuredH = Math.max(1, lines.length * fontSize * lineHeight);

        const nodeW = typeof layer.width === "number" && Number.isFinite(layer.width) && layer.width > 0 ? layer.width : measuredW;
        const nodeH = typeof layer.height === "number" && Number.isFinite(layer.height) && layer.height > 0 ? layer.height : measuredH;

        const padL = Number(layer.paddingLeft ?? 0);
        const padR = Number(layer.paddingRight ?? padL);
        const padT = Number(layer.paddingTop ?? 0);
        const padB = Number(layer.paddingBottom ?? padT);

        const x = Number(layer.x ?? 0) - padL;
        const y = Number(layer.y ?? 0) - padT;
        const w = nodeW + padL + padR;
        const h = nodeH + padT + padB;

        boxes.push({ x, y, w, h });
      } else if (layer.kind === "shape" || layer.kind === "container" || layer.kind === "image") {
        const x = Number(layer.x ?? 0);
        const y = Number(layer.y ?? 0);
        const w = typeof layer.width === "number" && Number.isFinite(layer.width) ? layer.width : 200;
        const h = typeof layer.height === "number" && Number.isFinite(layer.height) ? layer.height : 100;
        boxes.push({ x, y, w, h });
      }
    }
  }

  if (boxes.length === 0) return null;

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return { minX, minY, maxX, maxY, width, height };
}

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
        if (fitToContent) {
          const bounds = computeTemplateContentBounds(artifact, template, ctx);
          if (bounds && bounds.width > 0 && bounds.height > 0) {
            const marginFactor = 0.12; // 12% safety margin around content
            const maxScale = 3.5;
            const minScale = 1.0;
            const targetW = width * (1 - marginFactor * 2);
            const targetH = height * (1 - marginFactor * 2);
            const fitScale = Math.min(targetW / bounds.width, targetH / bounds.height);
            const scale = Math.min(maxScale, Math.max(minScale, fitScale));
            const contentCenterX = bounds.minX + bounds.width / 2;
            const contentCenterY = bounds.minY + bounds.height / 2;

            ctx.save();
            ctx.translate(width / 2, height / 2);
            ctx.scale(scale, scale);
            ctx.translate(-contentCenterX, -contentCenterY);

            renderTextTemplateToCanvas(ctx, {
              artifact,
              context: {
                environment: "preview",
                time: currentTime,
                width,
                height,
              },
            });

            ctx.restore();
          } else {
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
        } else {
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
