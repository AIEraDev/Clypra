import type { Clip } from "./index";

export type SmartOverlayType =
  | "list"
  | "stat"
  | "comparison"
  | "quote"
  | "timeline"
  | "code"
  | "social"
  | "lower-third";

export interface ListOverlayItem {
  id: string;
  text: string;
  startTime: number; // relative to clip start time (seconds)
  endTime: number;   // relative to clip start time (seconds)
  icon?: string;
  active?: boolean;
}

export interface ListOverlayContent {
  title: string;
  items: ListOverlayItem[];
}

export interface StatOverlayContent {
  value: string;         // e.g. "$1.2M", "73%", "+42%"
  label: string;         // e.g. "Annual Recurring Revenue"
  delta?: string;        // e.g. "+15% YoY"
  icon?: string;         // e.g. "trending-up", "dollar-sign"
}

export interface ComparisonItem {
  title: string;
  subtitle?: string;
  points: string[];
  color?: string;
}

export interface ComparisonOverlayContent {
  title: string;
  left: ComparisonItem;
  right: ComparisonItem;
}

export interface QuoteOverlayContent {
  quote: string;
  author: string;
  title?: string;        // e.g. "CEO & Founder"
  avatarUrl?: string;
}

export interface TimelineNode {
  id: string;
  label: string;
  date?: string;
  time: number;          // relative to clip start time (seconds)
  description?: string;
}

export interface TimelineOverlayContent {
  title: string;
  nodes: TimelineNode[];
}

export interface CodeOverlayContent {
  title?: string;
  language: string;      // e.g. "typescript", "python", "bash"
  code: string;
  highlightLines?: number[];
}

export interface SocialOverlayContent {
  platform: "x" | "youtube" | "github" | "instagram" | "tiktok";
  handle: string;
  name: string;
  verified?: boolean;
  avatarUrl?: string;
  message?: string;
  metrics?: string;      // e.g. "1.2M Followers"
}

export interface LowerThirdOverlayContent {
  name: string;
  title: string;
  company?: string;
  accentColor?: string;
}

export type SmartOverlayContentMap = {
  list: ListOverlayContent;
  stat: StatOverlayContent;
  comparison: ComparisonOverlayContent;
  quote: QuoteOverlayContent;
  timeline: TimelineOverlayContent;
  code: CodeOverlayContent;
  social: SocialOverlayContent;
  "lower-third": LowerThirdOverlayContent;
};

export type ListSmartOverlayContent = { type: "list"; data: ListOverlayContent };
export type StatSmartOverlayContent = { type: "stat"; data: StatOverlayContent };
export type ComparisonSmartOverlayContent = { type: "comparison"; data: ComparisonOverlayContent };
export type QuoteSmartOverlayContent = { type: "quote"; data: QuoteOverlayContent };
export type TimelineSmartOverlayContent = { type: "timeline"; data: TimelineOverlayContent };
export type CodeSmartOverlayContent = { type: "code"; data: CodeOverlayContent };
export type SocialSmartOverlayContent = { type: "social"; data: SocialOverlayContent };
export type LowerThirdSmartOverlayContent = { type: "lower-third"; data: LowerThirdOverlayContent };

export type SmartOverlayContentUnion =
  | ListSmartOverlayContent
  | StatSmartOverlayContent
  | ComparisonSmartOverlayContent
  | QuoteSmartOverlayContent
  | TimelineSmartOverlayContent
  | CodeSmartOverlayContent
  | SocialSmartOverlayContent
  | LowerThirdSmartOverlayContent;

export type SmartOverlayLayout = "full-screen" | "side-panel" | "lower-third" | "top-banner" | "center-card";
export type SmartOverlayAnimation = "slide-stagger" | "typewriter" | "scale-pop" | "fade" | "glow-pulse";

export interface SmartOverlayStyle {
  presetId: string;
  layout: SmartOverlayLayout;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  cardBackgroundColor: string;
  cardBorderColor?: string;
  cardOpacity: number; // 0.0 to 1.0
  animationStyle: SmartOverlayAnimation;
}

export interface SmartOverlayClip extends Clip {
  kind: "smart-overlay";
  overlayType: SmartOverlayType;
  content: SmartOverlayContentUnion;
  style: SmartOverlayStyle;
}

export interface SmartOverlayPreset {
  id: string;
  name: string;
  category: SmartOverlayType;
  description: string;
  previewThumbnail: string;
  defaultContent: SmartOverlayContentUnion;
  style: SmartOverlayStyle;
  isCustom?: boolean;
}

export const SMART_OVERLAY_PRESETS: SmartOverlayPreset[] = [
  {
    id: "stat-growth-metric",
    name: "Growth Metric Stat Card",
    category: "stat",
    description: "Prominent metric card featuring big numbers, glow highlights, and growth delta badge.",
    previewThumbnail: "",
    defaultContent: {
      type: "stat",
      data: {
        value: "+142%",
        label: "Quarterly User Growth",
        delta: "+35% vs target",
        icon: "trending-up",
      },
    },
    style: {
      presetId: "stat-growth-metric",
      layout: "center-card",
      fontFamily: "Outfit Variable",
      fontSize: 36,
      textColor: "#FFFFFF",
      highlightColor: "#10B981",
      cardBackgroundColor: "rgba(10, 15, 26, 0.90)",
      cardBorderColor: "#10B981",
      cardOpacity: 0.92,
      animationStyle: "scale-pop",
    },
  },
  {
    id: "quote-featured-callout",
    name: "Featured Quote Callout",
    category: "quote",
    description: "Stylized quotation box with oversized quotes, italicized typography, and author badge.",
    previewThumbnail: "",
    defaultContent: {
      type: "quote",
      data: {
        quote: "Simplicity is the ultimate sophistication.",
        author: "Leonardo da Vinci",
        title: "Artist & Engineer",
      },
    },
    style: {
      presetId: "quote-featured-callout",
      layout: "center-card",
      fontFamily: "Playfair Display Variable",
      fontSize: 32,
      textColor: "#F3F4F6",
      highlightColor: "#F59E0B",
      cardBackgroundColor: "rgba(20, 20, 25, 0.92)",
      cardBorderColor: "#F59E0B",
      cardOpacity: 0.9,
      animationStyle: "fade",
    },
  },
  {
    id: "comparison-split-card",
    name: "Side-by-Side Comparison",
    category: "comparison",
    description: "Dual-column comparison layout designed for evaluating alternatives or Pros vs Cons.",
    previewThumbnail: "",
    defaultContent: {
      type: "comparison",
      data: {
        title: "Framework Comparison",
        left: {
          title: "Option A",
          subtitle: "Legacy Stack",
          points: ["Slow render time", "Monolithic bundle"],
          color: "#EF4444",
        },
        right: {
          title: "Option B",
          subtitle: "Modern Stack",
          points: ["Sub-10ms latency", "Hardware accelerated"],
          color: "#10B981",
        },
      },
    },
    style: {
      presetId: "comparison-split-card",
      layout: "full-screen",
      fontFamily: "Inter Variable",
      fontSize: 28,
      textColor: "#FFFFFF",
      highlightColor: "#60A5FA",
      cardBackgroundColor: "rgba(15, 23, 42, 0.92)",
      cardBorderColor: "#3B82F6",
      cardOpacity: 0.9,
      animationStyle: "slide-stagger",
    },
  },
  {
    id: "code-terminal-card",
    name: "Terminal Code Snippet",
    category: "code",
    description: "Dark IDE window frame featuring window buttons, line numbers, and typewriter animation.",
    previewThumbnail: "",
    defaultContent: {
      type: "code",
      data: {
        title: "main.ts",
        language: "typescript",
        code: "const engine = new RenderEngine();\nawait engine.composeFrame(scene);\nconsole.log('Render complete!');",
        highlightLines: [2],
      },
    },
    style: {
      presetId: "code-terminal-card",
      layout: "center-card",
      fontFamily: "Geist Variable",
      fontSize: 26,
      textColor: "#00FFFF",
      highlightColor: "#A855F7",
      cardBackgroundColor: "rgba(9, 11, 16, 0.95)",
      cardBorderColor: "#00FFFF",
      cardOpacity: 0.95,
      animationStyle: "typewriter",
    },
  },
  {
    id: "list-hormozi-takeaway",
    name: "Hormozi List Card",
    category: "list",
    description: "High-contrast list card with speech-synced active line highlights.",
    previewThumbnail: "",
    defaultContent: {
      type: "list",
      data: {
        title: "Key Takeaways",
        items: [
          { id: "1", text: "First essential point", startTime: 0.5, endTime: 2.0 },
          { id: "2", text: "Second key takeaway", startTime: 2.2, endTime: 4.0 },
          { id: "3", text: "Final action item", startTime: 4.2, endTime: 6.0 },
        ],
      },
    },
    style: {
      presetId: "list-hormozi-takeaway",
      layout: "full-screen",
      fontFamily: "Outfit Variable",
      fontSize: 34,
      textColor: "#FFFFFF",
      highlightColor: "#FFE600",
      cardBackgroundColor: "rgba(15, 15, 18, 0.9)",
      cardBorderColor: "#FFE600",
      cardOpacity: 0.9,
      animationStyle: "slide-stagger",
    },
  },
  {
    id: "timeline-roadmap-nodes",
    name: "Milestone Process Timeline",
    category: "timeline",
    description: "Connected node timeline showing sequential milestones or project roadmap.",
    previewThumbnail: "",
    defaultContent: {
      type: "timeline",
      data: {
        title: "Project Roadmap",
        nodes: [
          { id: "1", label: "Phase 1: Architecture", time: 0.5, date: "Q1" },
          { id: "2", label: "Phase 2: Implementation", time: 2.5, date: "Q2" },
          { id: "3", label: "Phase 3: Launch", time: 4.5, date: "Q3" },
        ],
      },
    },
    style: {
      presetId: "timeline-roadmap-nodes",
      layout: "lower-third",
      fontFamily: "Inter Variable",
      fontSize: 26,
      textColor: "#FFFFFF",
      highlightColor: "#3B82F6",
      cardBackgroundColor: "rgba(15, 23, 42, 0.9)",
      cardBorderColor: "#3B82F6",
      cardOpacity: 0.9,
      animationStyle: "slide-stagger",
    },
  },
  {
    id: "social-post-card",
    name: "Social Media Callout",
    category: "social",
    description: "Mock social media post card with avatar, handle, verified checkmark, and message.",
    previewThumbnail: "",
    defaultContent: {
      type: "social",
      data: {
        platform: "x",
        name: "Clypra Studio",
        handle: "@clyprastudio",
        verified: true,
        message: "Professional video editing—free & open source forever. 🚀",
        metrics: "12.4K Reposts",
      },
    },
    style: {
      presetId: "social-post-card",
      layout: "center-card",
      fontFamily: "Inter Variable",
      fontSize: 28,
      textColor: "#FFFFFF",
      highlightColor: "#1DA1F2",
      cardBackgroundColor: "rgba(15, 20, 30, 0.92)",
      cardBorderColor: "#1DA1F2",
      cardOpacity: 0.92,
      animationStyle: "scale-pop",
    },
  },
  {
    id: "lower-third-name-tag",
    name: "Speaker Lower-Third",
    category: "lower-third",
    description: "Clean modern lower third name bar for speaker identity.",
    previewThumbnail: "",
    defaultContent: {
      type: "lower-third",
      data: {
        name: "Alex Rivera",
        title: "Lead Systems Architect",
        company: "Clypra Core Team",
        accentColor: "#8B5CF6",
      },
    },
    style: {
      presetId: "lower-third-name-tag",
      layout: "lower-third",
      fontFamily: "Outfit Variable",
      fontSize: 26,
      textColor: "#FFFFFF",
      highlightColor: "#8B5CF6",
      cardBackgroundColor: "rgba(10, 10, 15, 0.88)",
      cardBorderColor: "#8B5CF6",
      cardOpacity: 0.88,
      animationStyle: "slide-stagger",
    },
  },
];

export function getSmartOverlayPreset(presetId: string): SmartOverlayPreset {
  return SMART_OVERLAY_PRESETS.find((p) => p.id === presetId) || SMART_OVERLAY_PRESETS[0];
}
