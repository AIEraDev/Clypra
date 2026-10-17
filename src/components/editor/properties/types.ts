export type TextPropertyTab =
  | "text"
  | "animation"
  | "tracking"
  | "tts"
  | "ai_avatars";

export type VideoPropertyTab = "video" | "audio" | "speed" | "animation";

export interface PropertyTabsType {
  id: TextPropertyTab | VideoPropertyTab;
  labelKey: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}
