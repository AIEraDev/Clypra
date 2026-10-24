import {
  Type,
  Sparkles,
  Volume2,
  Video,
  Gauge,
  Sliders,
  Mic,
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
];

export const VIDEO_TABS: PropertyTabsType[] = [
  {
    id: "video",
    labelKey: "properties.tabs.video",
    label: "Video",
    icon: Video,
  },
  {
    id: "audio",
    labelKey: "properties.tabs.audio",
    label: "Audio",
    icon: Volume2,
  },
  {
    id: "speed",
    labelKey: "properties.tabs.speed",
    label: "Speed",
    icon: Gauge,
  },
  {
    id: "animation",
    labelKey: "properties.tabs.animation",
    label: "Animation",
    icon: Sparkles,
  },
  {
    id: "adjust",
    labelKey: "properties.tabs.adjust",
    label: "Adjust",
    icon: Sliders,
  },
];

export const AUDIO_TABS: PropertyTabsType[] = [
  {
    id: "basic",
    labelKey: "properties.tabs.basic",
    label: "Basic",
    icon: Sliders,
  },
  {
    id: "voice-changer",
    labelKey: "properties.tabs.voiceChanger",
    label: "Voice changer",
    icon: Mic,
  },
  {
    id: "speed",
    labelKey: "properties.tabs.speed",
    label: "Speed",
    icon: Gauge,
  },
];
