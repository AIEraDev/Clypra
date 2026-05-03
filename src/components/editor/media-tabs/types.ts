export type TabType = "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions";

export interface TabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
}
