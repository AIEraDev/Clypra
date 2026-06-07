export type TabType = "media" | "audio" | "text" | "stickers" | "effects" | "filters" | "transitions" | "captions";

export interface TabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
  className?: string;
}

export interface MediaTabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
  initialTab?: TabType;
}
