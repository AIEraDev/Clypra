/**
 * Motion Behavior & Kinetic Preset Catalog & Compiler.
 *
 * Implements one-click Build-In, Build-Out, and Continuous Loop animations.
 * Compiles high-level behavior configurations into responsive, time-anchored
 * visual property keyframes (`anchor: "start"` and `anchor: "end"`).
 */

import type { VisualPropertyKey, VisualPropertyKeyframe } from "@/types";
import type { ClipMotionConfig, MotionPresetMeta } from "@/types/motion";

export const MOTION_IN_PRESETS: MotionPresetMeta[] = [
  {
    id: "typewriter",
    name: "Typewriter",
    category: "in",
    subCategory: "Basic",
    tags: ["typewriter", "terminal", "typing", "text"],
    description: "Snappy character typing entrance",
    defaultDuration: 0.6,
    defaultEasing: "easeOut",
    icon: "Type",
  },
  {
    id: "slide-up",
    name: "Slide Up",
    category: "in",
    subCategory: "Motion",
    tags: ["slide", "up", "motion", "smooth"],
    description: "Smooth upward entrance from below",
    defaultDuration: 0.5,
    defaultEasing: "easeOutCubic",
    icon: "ArrowUp",
  },
  {
    id: "zoom-in",
    name: "Zoom In",
    category: "in",
    subCategory: "Motion",
    tags: ["zoom", "pop", "bounce", "scale"],
    description: "Punchy dynamic zoom impact with hero velocity",
    defaultDuration: 0.4,
    defaultEasing: "speedHero",
    icon: "ZoomIn",
  },
  {
    id: "flip-in",
    name: "Flip In",
    category: "in",
    subCategory: "3D",
    tags: ["flip", "3d", "rotate", "perspective"],
    description: "3D rotational flip entrance",
    defaultDuration: 0.6,
    defaultEasing: "easeOutQuad",
    icon: "RotateCw",
  },
  {
    id: "wave-in",
    name: "Wave In",
    category: "in",
    subCategory: "Motion",
    tags: ["wave", "bounce", "stagger"],
    description: "Rhythmic vertical wave bounce entrance",
    defaultDuration: 0.7,
    defaultEasing: "springBouncy",
    icon: "Waves",
  },
  {
    id: "glitch-in",
    name: "Glitch In",
    category: "in",
    subCategory: "Glitch",
    tags: ["glitch", "cyber", "jitter", "vfx"],
    isPro: true,
    description: "Cyberpunk high-frequency glitch jitter",
    defaultDuration: 0.5,
    defaultEasing: "easeOut",
    icon: "Zap",
  },
  {
    id: "arc-fade",
    name: "Arc Fade",
    category: "in",
    subCategory: "Basic",
    tags: ["arc", "fade", "cinematic"],
    description: "Cinematic scale dissipation into focus",
    defaultDuration: 0.6,
    defaultEasing: "easeOutCubic",
    icon: "Sun",
  },
  {
    id: "fade-in",
    name: "Fade In",
    category: "in",
    subCategory: "Basic",
    tags: ["fade", "simple", "clean"],
    description: "Clean organic opacity emergence",
    defaultDuration: 0.5,
    defaultEasing: "easeOut",
    icon: "Sun",
  },
  {
    id: "pop-in",
    name: "Pop In",
    category: "in",
    subCategory: "Motion",
    tags: ["pop", "spring", "snappy"],
    description: "Snappy spring pop with subtle overshoot",
    defaultDuration: 0.5,
    defaultEasing: "springSnappy",
    icon: "Zap",
  },
  {
    id: "bounce-in",
    name: "Bounce In",
    category: "in",
    subCategory: "Motion",
    tags: ["bounce", "physics", "drop"],
    description: "Energetic physics-modeled drop and bounce",
    defaultDuration: 0.65,
    defaultEasing: "springBouncy",
    icon: "Activity",
  },
  {
    id: "slide-down",
    name: "Slide Down",
    category: "in",
    subCategory: "Motion",
    tags: ["slide", "down", "smooth"],
    description: "Smooth downward entrance from above",
    defaultDuration: 0.5,
    defaultEasing: "easeOutCubic",
    icon: "ArrowDown",
  },
  {
    id: "slide-left",
    name: "Slide Left",
    category: "in",
    subCategory: "Motion",
    tags: ["slide", "left", "glide"],
    description: "Smooth horizontal glide from the right",
    defaultDuration: 0.5,
    defaultEasing: "easeOutCubic",
    icon: "ArrowLeft",
  },
  {
    id: "slide-right",
    name: "Slide Right",
    category: "in",
    subCategory: "Motion",
    tags: ["slide", "right", "glide"],
    description: "Smooth horizontal glide from the left",
    defaultDuration: 0.5,
    defaultEasing: "easeOutCubic",
    icon: "ArrowRight",
  },
  {
    id: "whip-pan",
    name: "Whip Pan",
    category: "in",
    subCategory: "Motion",
    tags: ["whip", "fast", "speed"],
    description: "High-speed kinetic horizontal transit",
    defaultDuration: 0.35,
    defaultEasing: "easeOutExpo",
    icon: "FastForward",
  },
];

export const MOTION_OUT_PRESETS: MotionPresetMeta[] = [
  {
    id: "fade-out",
    name: "Fade Out",
    category: "out",
    subCategory: "Basic",
    tags: ["fade", "out", "simple"],
    description: "Gentle opacity fade to transparent",
    defaultDuration: 0.5,
    defaultEasing: "easeIn",
    icon: "Moon",
  },
  {
    id: "slide-down",
    name: "Slide Down",
    category: "out",
    subCategory: "Motion",
    tags: ["slide", "down", "exit"],
    description: "Glides downward off-canvas",
    defaultDuration: 0.45,
    defaultEasing: "easeInCubic",
    icon: "ArrowDown",
  },
  {
    id: "slide-up",
    name: "Slide Up",
    category: "out",
    subCategory: "Motion",
    tags: ["slide", "up", "exit"],
    description: "Glides upward off-canvas",
    defaultDuration: 0.45,
    defaultEasing: "easeInCubic",
    icon: "ArrowUp",
  },
  {
    id: "slide-left",
    name: "Slide Left",
    category: "out",
    subCategory: "Motion",
    tags: ["slide", "left", "exit"],
    description: "Glides off to the left edge",
    defaultDuration: 0.45,
    defaultEasing: "easeInCubic",
    icon: "ArrowLeft",
  },
  {
    id: "slide-right",
    name: "Slide Right",
    category: "out",
    subCategory: "Motion",
    tags: ["slide", "right", "exit"],
    description: "Glides off to the right edge",
    defaultDuration: 0.45,
    defaultEasing: "easeInCubic",
    icon: "ArrowRight",
  },
  {
    id: "pop-out",
    name: "Pop Out",
    category: "out",
    subCategory: "Motion",
    tags: ["pop", "shrink", "exit"],
    description: "Anticipation wind-up into fast shrink",
    defaultDuration: 0.4,
    defaultEasing: "easeInBack",
    icon: "Minimize2",
  },
  {
    id: "drop-down",
    name: "Gravity Drop",
    category: "out",
    subCategory: "Motion",
    tags: ["gravity", "drop", "physics"],
    description: "Accelerating drop with slight rotational tilt",
    defaultDuration: 0.5,
    defaultEasing: "easeInQuad",
    icon: "Download",
  },
  {
    id: "zoom-out",
    name: "Zoom Out",
    category: "out",
    subCategory: "Motion",
    tags: ["zoom", "distance", "shrink"],
    description: "Dissolves rapidly into distance",
    defaultDuration: 0.4,
    defaultEasing: "easeOutExpo",
    icon: "ZoomOut",
  },
  {
    id: "flip-out",
    name: "Flip Out",
    category: "out",
    subCategory: "3D",
    tags: ["flip", "3d", "rotate", "exit"],
    description: "3D rotational flip departure",
    defaultDuration: 0.5,
    defaultEasing: "easeInQuad",
    icon: "RotateCcw",
  },
  {
    id: "8bit-melt",
    name: "8bit Melt",
    category: "out",
    subCategory: "Glitch",
    tags: ["melt", "glitch", "pixel", "retro"],
    isPro: true,
    description: "Retro pixelated dissolve exit",
    defaultDuration: 0.5,
    defaultEasing: "easeIn",
    icon: "Zap",
  },
  {
    id: "whirl-out",
    name: "Whirl Out",
    category: "out",
    subCategory: "3D",
    tags: ["whirl", "spin", "rotate", "tornado"],
    description: "High-speed rotational vortex departure",
    defaultDuration: 0.45,
    defaultEasing: "easeInBack",
    icon: "Shuffle",
  },
];

export const MOTION_LOOP_PRESETS: MotionPresetMeta[] = [
  {
    id: "float",
    name: "Float",
    category: "loop",
    subCategory: "Motion",
    tags: ["float", "drift", "levitate"],
    description: "Weightless organic vertical and horizontal drift",
    icon: "Waves",
  },
  {
    id: "pulse",
    name: "Pulse",
    category: "loop",
    subCategory: "Basic",
    tags: ["pulse", "breathe", "scale"],
    description: "Rhythmic gentle scale expansion and contraction",
    icon: "Heart",
  },
  {
    id: "wiggle",
    name: "Wiggle",
    category: "loop",
    subCategory: "Motion",
    tags: ["wiggle", "shake", "rotate"],
    description: "Continuous subtle rotational oscillation",
    icon: "Shuffle",
  },
  {
    id: "heartbeat",
    name: "Heartbeat",
    category: "loop",
    subCategory: "Basic",
    tags: ["heartbeat", "pulse", "thump"],
    description: "Double-thump dynamic pulse",
    icon: "Activity",
  },
  {
    id: "pendulum",
    name: "Pendulum",
    category: "loop",
    subCategory: "Motion",
    tags: ["pendulum", "swing", "clock"],
    description: "Harmonic pendulum swing around center",
    icon: "Compass",
  },
  {
    id: "wave",
    name: "Wave",
    category: "loop",
    subCategory: "Motion",
    tags: ["wave", "ocean", "sway"],
    description: "Continuous undulating wave flow",
    icon: "Waves",
  },
  {
    id: "neon-blink",
    name: "Neon Blink",
    category: "loop",
    subCategory: "Glitch",
    tags: ["neon", "blink", "strobe", "flash"],
    isPro: true,
    description: "Atmospheric flickering neon sign pulse",
    icon: "Zap",
  },
  {
    id: "shiver",
    name: "Shiver",
    category: "loop",
    subCategory: "Glitch",
    tags: ["shiver", "jitter", "tremble"],
    description: "High-frequency subtle tension vibration",
    icon: "Activity",
  },
];

/**
 * Compiles In and Out motion presets into responsive, time-anchored visualKeyframes.
 */
export function compileClipMotionKeyframes(
  clip: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    opacity?: number;
    visualKeyframes?: Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>>;
  },
  motion: ClipMotionConfig | undefined,
  canvasWidth = 1920,
  canvasHeight = 1080
): Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>> {
  if (!motion) {
    return clip.visualKeyframes ? { ...clip.visualKeyframes } : {};
  }

  const baseX = clip.x ?? 0;
  const baseY = clip.y ?? 0;
  const baseW = Math.abs(clip.width ?? 100);
  const baseH = Math.abs(clip.height ?? 100);
  const baseRot = clip.rotation ?? 0;
  const baseOp = clip.opacity ?? 1;

  // We start from an empty set or filter out previous motion-tagged keyframes
  const result: Partial<Record<VisualPropertyKey, VisualPropertyKeyframe[]>> = {};

  // Helper to append a keyframe
  const pushKf = (
    prop: VisualPropertyKey,
    kf: VisualPropertyKeyframe
  ) => {
    if (!result[prop]) result[prop] = [];
    result[prop]!.push(kf);
  };

  // ── 1. Compile IN Preset (anchor: "start") ──────────────────────────────────
  const inPreset = motion.inPreset;
  const inDuration = Math.max(0.1, motion.inDuration ?? 0.5);
  const inDist = motion.inDistance ?? Math.min(canvasHeight * 0.4, 300);

  if (inPreset && inPreset !== "none") {
    switch (inPreset) {
      case "pop-in": {
        const easing = motion.inEasing ?? "springSnappy";
        pushKf("width", {
          id: "m-in-w0",
          time: 0,
          anchor: "start",
          value: 0,
          easing,
          spring: motion.inSpring,
        });
        pushKf("width", {
          id: "m-in-w1",
          time: inDuration,
          anchor: "start",
          value: baseW,
          easing,
          spring: motion.inSpring,
        });

        pushKf("height", {
          id: "m-in-h0",
          time: 0,
          anchor: "start",
          value: 0,
          easing,
          spring: motion.inSpring,
        });
        pushKf("height", {
          id: "m-in-h1",
          time: inDuration,
          anchor: "start",
          value: baseH,
          easing,
          spring: motion.inSpring,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: Math.min(inDuration * 0.5, 0.2),
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "bounce-in": {
        const easing = motion.inEasing ?? "springBouncy";
        pushKf("y", {
          id: "m-in-y0",
          time: 0,
          anchor: "start",
          value: baseY - inDist,
          easing,
          spring: motion.inSpring,
        });
        pushKf("y", {
          id: "m-in-y1",
          time: inDuration,
          anchor: "start",
          value: baseY,
          easing,
          spring: motion.inSpring,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: Math.min(inDuration * 0.4, 0.2),
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "slide-up": {
        const easing = motion.inEasing ?? "easeOutCubic";
        pushKf("y", {
          id: "m-in-y0",
          time: 0,
          anchor: "start",
          value: baseY + inDist,
          easing,
        });
        pushKf("y", {
          id: "m-in-y1",
          time: inDuration,
          anchor: "start",
          value: baseY,
          easing,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "slide-down": {
        const easing = motion.inEasing ?? "easeOutCubic";
        pushKf("y", {
          id: "m-in-y0",
          time: 0,
          anchor: "start",
          value: baseY - inDist,
          easing,
        });
        pushKf("y", {
          id: "m-in-y1",
          time: inDuration,
          anchor: "start",
          value: baseY,
          easing,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "slide-left": {
        const easing = motion.inEasing ?? "easeOutCubic";
        pushKf("x", {
          id: "m-in-x0",
          time: 0,
          anchor: "start",
          value: baseX + inDist,
          easing,
        });
        pushKf("x", {
          id: "m-in-x1",
          time: inDuration,
          anchor: "start",
          value: baseX,
          easing,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "slide-right": {
        const easing = motion.inEasing ?? "easeOutCubic";
        pushKf("x", {
          id: "m-in-x0",
          time: 0,
          anchor: "start",
          value: baseX - inDist,
          easing,
        });
        pushKf("x", {
          id: "m-in-x1",
          time: inDuration,
          anchor: "start",
          value: baseX,
          easing,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "zoom-in": {
        const easing = motion.inEasing ?? "speedHero";
        pushKf("width", {
          id: "m-in-w0",
          time: 0,
          anchor: "start",
          value: baseW * 0.1,
          easing,
        });
        pushKf("width", {
          id: "m-in-w1",
          time: inDuration,
          anchor: "start",
          value: baseW,
          easing,
        });

        pushKf("height", {
          id: "m-in-h0",
          time: 0,
          anchor: "start",
          value: baseH * 0.1,
          easing,
        });
        pushKf("height", {
          id: "m-in-h1",
          time: inDuration,
          anchor: "start",
          value: baseH,
          easing,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration * 0.5,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "fade-in": {
        const easing = motion.inEasing ?? "easeOut";
        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing,
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration,
          anchor: "start",
          value: baseOp,
          easing,
        });
        break;
      }

      case "whip-pan": {
        const easing = motion.inEasing ?? "easeOutExpo";
        pushKf("x", {
          id: "m-in-x0",
          time: 0,
          anchor: "start",
          value: baseX - canvasWidth * 0.6,
          easing,
        });
        pushKf("x", {
          id: "m-in-x1",
          time: inDuration,
          anchor: "start",
          value: baseX,
          easing,
        });

        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration * 0.3,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "typewriter": {
        const easing = motion.inEasing ?? "easeOut";
        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "linear",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration * 0.1,
          anchor: "start",
          value: baseOp,
          easing: "linear",
        });
        pushKf("width", {
          id: "m-in-w0",
          time: 0,
          anchor: "start",
          value: baseW * 0.95,
          easing,
        });
        pushKf("width", {
          id: "m-in-w1",
          time: inDuration,
          anchor: "start",
          value: baseW,
          easing,
        });
        pushKf("height", {
          id: "m-in-h0",
          time: 0,
          anchor: "start",
          value: baseH * 0.95,
          easing,
        });
        pushKf("height", {
          id: "m-in-h1",
          time: inDuration,
          anchor: "start",
          value: baseH,
          easing,
        });
        break;
      }

      case "flip-in": {
        const easing = motion.inEasing ?? "easeOutQuad";
        pushKf("rotation", {
          id: "m-in-r0",
          time: 0,
          anchor: "start",
          value: baseRot - 90,
          easing,
        });
        pushKf("rotation", {
          id: "m-in-r1",
          time: inDuration,
          anchor: "start",
          value: baseRot,
          easing,
        });
        pushKf("y", {
          id: "m-in-y0",
          time: 0,
          anchor: "start",
          value: baseY - 30,
          easing: "easeOutBack",
        });
        pushKf("y", {
          id: "m-in-y1",
          time: inDuration,
          anchor: "start",
          value: baseY,
          easing: "easeOutBack",
        });
        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration * 0.6,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "wave-in": {
        const easing = motion.inEasing ?? "springBouncy";
        pushKf("y", {
          id: "m-in-y0",
          time: 0,
          anchor: "start",
          value: baseY + 50,
          easing,
          spring: motion.inSpring,
        });
        pushKf("y", {
          id: "m-in-y1",
          time: inDuration,
          anchor: "start",
          value: baseY,
          easing,
          spring: motion.inSpring,
        });
        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOut",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration * 0.5,
          anchor: "start",
          value: baseOp,
          easing: "easeOut",
        });
        break;
      }

      case "glitch-in": {
        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "linear",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration * 0.2,
          anchor: "start",
          value: baseOp * 0.7,
          easing: "linear",
        });
        pushKf("opacity", {
          id: "m-in-o2",
          time: inDuration * 0.4,
          anchor: "start",
          value: baseOp * 0.2,
          easing: "linear",
        });
        pushKf("opacity", {
          id: "m-in-o3",
          time: inDuration * 0.6,
          anchor: "start",
          value: baseOp,
          easing: "linear",
        });
        pushKf("x", {
          id: "m-in-x0",
          time: 0,
          anchor: "start",
          value: baseX - 25,
          easing: "linear",
        });
        pushKf("x", {
          id: "m-in-x1",
          time: inDuration * 0.3,
          anchor: "start",
          value: baseX + 18,
          easing: "linear",
        });
        pushKf("x", {
          id: "m-in-x2",
          time: inDuration * 0.6,
          anchor: "start",
          value: baseX - 6,
          easing: "linear",
        });
        pushKf("x", {
          id: "m-in-x3",
          time: inDuration,
          anchor: "start",
          value: baseX,
          easing: "linear",
        });
        break;
      }

      case "arc-fade": {
        const easing = motion.inEasing ?? "easeOutCubic";
        pushKf("width", {
          id: "m-in-w0",
          time: 0,
          anchor: "start",
          value: baseW * 1.35,
          easing,
        });
        pushKf("width", {
          id: "m-in-w1",
          time: inDuration,
          anchor: "start",
          value: baseW,
          easing,
        });
        pushKf("height", {
          id: "m-in-h0",
          time: 0,
          anchor: "start",
          value: baseH * 1.35,
          easing,
        });
        pushKf("height", {
          id: "m-in-h1",
          time: inDuration,
          anchor: "start",
          value: baseH,
          easing,
        });
        pushKf("opacity", {
          id: "m-in-o0",
          time: 0,
          anchor: "start",
          value: 0,
          easing: "easeOutQuad",
        });
        pushKf("opacity", {
          id: "m-in-o1",
          time: inDuration,
          anchor: "start",
          value: baseOp,
          easing: "easeOutQuad",
        });
        break;
      }
    }
  }

  // ── 2. Compile OUT Preset (anchor: "end") ────────────────────────────────────
  const outPreset = motion.outPreset;
  const outDuration = Math.max(0.1, motion.outDuration ?? 0.5);
  const outDist = motion.outDistance ?? Math.min(canvasHeight * 0.4, 300);

  if (outPreset && outPreset !== "none") {
    switch (outPreset) {
      case "fade-out": {
        const easing = motion.outEasing ?? "easeIn";
        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing,
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });
        break;
      }

      case "pop-out": {
        const easing = motion.outEasing ?? "easeInBack";
        pushKf("width", {
          id: "m-out-w0",
          time: outDuration,
          anchor: "end",
          value: baseW,
          easing,
          spring: motion.outSpring,
        });
        pushKf("width", {
          id: "m-out-w1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
          spring: motion.outSpring,
        });

        pushKf("height", {
          id: "m-out-h0",
          time: outDuration,
          anchor: "end",
          value: baseH,
          easing,
          spring: motion.outSpring,
        });
        pushKf("height", {
          id: "m-out-h1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
          spring: motion.outSpring,
        });

        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration * 0.4,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }

      case "slide-down": {
        const easing = motion.outEasing ?? "easeInCubic";
        pushKf("y", {
          id: "m-out-y0",
          time: outDuration,
          anchor: "end",
          value: baseY,
          easing,
        });
        pushKf("y", {
          id: "m-out-y1",
          time: 0,
          anchor: "end",
          value: baseY + outDist,
          easing,
        });

        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }

      case "slide-up": {
        const easing = motion.outEasing ?? "easeInCubic";
        pushKf("y", {
          id: "m-out-y0",
          time: outDuration,
          anchor: "end",
          value: baseY,
          easing,
        });
        pushKf("y", {
          id: "m-out-y1",
          time: 0,
          anchor: "end",
          value: baseY - outDist,
          easing,
        });

        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }

      case "slide-left": {
        const easing = motion.outEasing ?? "easeInCubic";
        pushKf("x", {
          id: "m-out-x0",
          time: outDuration,
          anchor: "end",
          value: baseX,
          easing,
        });
        pushKf("x", {
          id: "m-out-x1",
          time: 0,
          anchor: "end",
          value: baseX - outDist,
          easing,
        });

        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }

      case "slide-right": {
        const easing = motion.outEasing ?? "easeInCubic";
        pushKf("x", {
          id: "m-out-x0",
          time: outDuration,
          anchor: "end",
          value: baseX,
          easing,
        });
        pushKf("x", {
          id: "m-out-x1",
          time: 0,
          anchor: "end",
          value: baseX + outDist,
          easing,
        });

        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }

      case "drop-down": {
        const easing = motion.outEasing ?? "easeInQuad";
        pushKf("y", {
          id: "m-out-y0",
          time: outDuration,
          anchor: "end",
          value: baseY,
          easing,
        });
        pushKf("y", {
          id: "m-out-y1",
          time: 0,
          anchor: "end",
          value: canvasHeight + baseH * 0.5,
          easing,
        });

        pushKf("rotation", {
          id: "m-out-r0",
          time: outDuration,
          anchor: "end",
          value: baseRot,
          easing,
        });
        pushKf("rotation", {
          id: "m-out-r1",
          time: 0,
          anchor: "end",
          value: baseRot + 12,
          easing,
        });
        break;
      }

      case "zoom-out": {
        const easing = motion.outEasing ?? "easeOutExpo";
        pushKf("width", {
          id: "m-out-w0",
          time: outDuration,
          anchor: "end",
          value: baseW,
          easing,
        });
        pushKf("width", {
          id: "m-out-w1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });

        pushKf("height", {
          id: "m-out-h0",
          time: outDuration,
          anchor: "end",
          value: baseH,
          easing,
        });
        pushKf("height", {
          id: "m-out-h1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });

        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing,
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });
        break;
      }

      case "flip-out": {
        const easing = motion.outEasing ?? "easeInQuad";
        pushKf("rotation", {
          id: "m-out-r0",
          time: outDuration,
          anchor: "end",
          value: baseRot,
          easing,
        });
        pushKf("rotation", {
          id: "m-out-r1",
          time: 0,
          anchor: "end",
          value: baseRot + 90,
          easing,
        });
        pushKf("y", {
          id: "m-out-y0",
          time: outDuration,
          anchor: "end",
          value: baseY,
          easing,
        });
        pushKf("y", {
          id: "m-out-y1",
          time: 0,
          anchor: "end",
          value: baseY - 30,
          easing,
        });
        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }

      case "8bit-melt": {
        const easing = motion.outEasing ?? "easeIn";
        pushKf("y", {
          id: "m-out-y0",
          time: outDuration,
          anchor: "end",
          value: baseY,
          easing,
        });
        pushKf("y", {
          id: "m-out-y1",
          time: 0,
          anchor: "end",
          value: baseY + outDist * 0.8,
          easing,
        });
        pushKf("width", {
          id: "m-out-w0",
          time: outDuration,
          anchor: "end",
          value: baseW,
          easing,
        });
        pushKf("width", {
          id: "m-out-w1",
          time: 0,
          anchor: "end",
          value: baseW * 1.3,
          easing,
        });
        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration * 0.5,
          anchor: "end",
          value: baseOp,
          easing,
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });
        break;
      }

      case "whirl-out": {
        const easing = motion.outEasing ?? "easeInBack";
        pushKf("rotation", {
          id: "m-out-r0",
          time: outDuration,
          anchor: "end",
          value: baseRot,
          easing,
        });
        pushKf("rotation", {
          id: "m-out-r1",
          time: 0,
          anchor: "end",
          value: baseRot + 360,
          easing,
        });
        pushKf("width", {
          id: "m-out-w0",
          time: outDuration,
          anchor: "end",
          value: baseW,
          easing,
        });
        pushKf("width", {
          id: "m-out-w1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });
        pushKf("height", {
          id: "m-out-h0",
          time: outDuration,
          anchor: "end",
          value: baseH,
          easing,
        });
        pushKf("height", {
          id: "m-out-h1",
          time: 0,
          anchor: "end",
          value: 0,
          easing,
        });
        pushKf("opacity", {
          id: "m-out-o0",
          time: outDuration,
          anchor: "end",
          value: baseOp,
          easing: "easeIn",
        });
        pushKf("opacity", {
          id: "m-out-o1",
          time: 0,
          anchor: "end",
          value: 0,
          easing: "easeIn",
        });
        break;
      }
    }
  }

  return result;
}

/**
 * Applies continuous loop emphasis modulation (Float, Pulse, Wiggle, etc.)
 * onto an evaluated base transform at a given clip-relative time offset.
 */
export function applyLoopMotion(
  loopPreset: string | undefined,
  time: number,
  base: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
  },
  speed = 1.0,
  intensity = 1.0
): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
} {
  if (!loopPreset || loopPreset === "none") {
    return { ...base };
  }

  const s = Math.max(0.1, speed);
  const inten = Math.max(0.1, intensity);
  const omega = 2.0 * Math.PI * s * 0.5; // ~0.5 Hz default frequency

  switch (loopPreset) {
    case "float": {
      // Harmonic gentle floating: sinusoidal Y oscillation + slight X wobble
      const yOffset = Math.sin(time * omega) * 12 * inten;
      const xOffset = Math.cos(time * omega * 0.6) * 5 * inten;
      return {
        ...base,
        x: base.x + xOffset,
        y: base.y + yOffset,
      };
    }

    case "pulse": {
      // Smooth rhythmic breathing expansion (1.0 +/- 4%)
      const scaleMult = 1.0 + Math.sin(time * omega * 1.2) * 0.04 * inten;
      return {
        ...base,
        width: Math.round(base.width * scaleMult),
        height: Math.round(base.height * scaleMult),
      };
    }

    case "wiggle": {
      // Multi-frequency rotational wiggle
      const rotOffset = Math.sin(time * omega * 2.2) * 3.5 * inten;
      return {
        ...base,
        rotation: base.rotation + rotOffset,
      };
    }

    case "heartbeat": {
      // Double thump beat every cycle (1s cycle / speed)
      const period = 1.2 / s;
      const localT = (time % period) / period;
      let thump = 0;
      if (localT < 0.15) {
        thump = Math.sin((localT / 0.15) * Math.PI) * 0.07;
      } else if (localT > 0.22 && localT < 0.37) {
        thump = Math.sin(((localT - 0.22) / 0.15) * Math.PI) * 0.04;
      }
      const scaleMult = 1.0 + thump * inten;
      return {
        ...base,
        width: Math.round(base.width * scaleMult),
        height: Math.round(base.height * scaleMult),
      };
    }

    case "pendulum": {
      // Smooth sinusoidal swing around origin
      const rotOffset = Math.sin(time * omega * 0.8) * 6.0 * inten;
      return {
        ...base,
        rotation: base.rotation + rotOffset,
      };
    }

    case "wave": {
      // Sinusoidal undulating wave flow
      const yOffset = Math.sin(time * omega * 1.5) * 14 * inten;
      const rotOffset = Math.sin(time * omega * 0.8) * 4 * inten;
      return {
        ...base,
        y: base.y + yOffset,
        rotation: base.rotation + rotOffset,
      };
    }

    case "neon-blink": {
      // Atmospheric flickering neon pulse
      const cycle = (time * s * 2.5) % 1;
      const blink = cycle < 0.1 || (cycle > 0.25 && cycle < 0.32) ? 0.2 : 1.0;
      return {
        ...base,
        opacity: base.opacity * (1.0 - (1.0 - blink) * inten),
      };
    }

    case "shiver": {
      // High-frequency subtle jitter
      const jX = Math.sin(time * 35 * s) * 3 * inten;
      const jY = Math.cos(time * 42 * s) * 2 * inten;
      return {
        ...base,
        x: base.x + jX,
        y: base.y + jY,
      };
    }

    default:
      return { ...base };
  }
}
