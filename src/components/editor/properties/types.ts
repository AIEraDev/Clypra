export type TextPropertyTab =
  | "text"
  | "animation"
  | "tracking"
  | "tts"
  | "ai_avatars";

export type VideoPropertyTab =
  | "video"
  | "audio"
  | "speed"
  | "animation"
  | "adjust";

export type ImagePropertyTab = "image" | "animation" | "adjust";

export type AudioPropertyTab = "basic" | "voice-changer" | "speed";

export interface PropertyTabsType {
  id: TextPropertyTab | VideoPropertyTab | ImagePropertyTab | AudioPropertyTab;
  labelKey: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}
