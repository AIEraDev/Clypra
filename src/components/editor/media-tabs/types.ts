export type TabType = "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions";

export interface MediaTabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
}
