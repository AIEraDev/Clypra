export type TabType = "media" | "cuts" | "audio" | "text" | "stickers" | "effects" | "filters" | "transitions" | "captions" | "video-effects" | "body-effects" | "animated-overlays";

export interface TabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
  className?: string;
}

export interface MediaTabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
  initialTab?: TabType;
}
