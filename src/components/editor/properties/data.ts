import {
  Type,
  Layout,
  Sparkles,
  Crosshair,
  Volume2,
  UserCheck,
} from "lucide-react";
import { PropertyTabsType } from "./types";

export const TEXT_TABS: PropertyTabsType[] = [
  { id: "text", labelKey: "properties.tabs.text", label: "Text", icon: Type },
  {
    id: "animation",
    labelKey: "properties.tabs.animation",
    label: "Animation",
    icon: Sparkles,
  },
  {
    id: "tracking",
    labelKey: "properties.tabs.tracking",
    label: "Tracking",
    icon: Crosshair,
  },
  {
    id: "tts",
    labelKey: "properties.tabs.tts",
    label: "Text to speech",
    icon: Volume2,
  },
  {
    id: "ai_avatars",
    labelKey: "properties.tabs.aiAvatars",
    label: "AI avatars",
    icon: UserCheck,
  },
];
