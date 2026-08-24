import type { LucideIcon } from "lucide-react";
import type { Clip, Track } from "@/types";

export type ClipCommandGroup =
  | "clipboard"
  | "trim"
  | "speed"
  | "audio"
  | "enable"
  | "organize"
  | "media"
  | "info"
  | "timeline";

export interface ClipCommandContext {
  selectedClipIds: string[];
  clickedClipId: string | null;
  clickedTrackId?: string | null;
  playheadTime: number;
  clips: Clip[];
  tracks: Track[];
}

export interface ClipCommand {
  id: string;
  label: string;
  /** Link to shortcutStore action ID for dynamic shortcut binding formatting */
  shortcutId?: string;
  /** Explicit fallback shortcut string (e.g. "⌫", "⌥⌫") */
  shortcutLabel?: string;
  icon?: LucideIcon;
  group: ClipCommandGroup;
  danger?: boolean;
  /** Explains why command is disabled when isEnabled returns false */
  disabledReason?: (ctx: ClipCommandContext) => string | undefined;
  isVisible: (ctx: ClipCommandContext) => boolean;
  isEnabled: (ctx: ClipCommandContext) => boolean;
  execute: (ctx: ClipCommandContext) => void | Promise<void>;
}

export type TimelineCommandGroup = "clipboard" | "gap" | "track";

export interface TimelineCommandContext {
  clickedTrackId: string | null;
  clickedTime: number;
  playheadTime: number;
  tracks: Track[];
  clips: Clip[];
  hasClipboard: boolean;
}

export interface TimelineCommand {
  id: string;
  label: string;
  shortcutId?: string;
  shortcutLabel?: string;
  icon?: LucideIcon;
  group: TimelineCommandGroup;
  danger?: boolean;
  disabledReason?: (ctx: TimelineCommandContext) => string | undefined;
  isVisible: (ctx: TimelineCommandContext) => boolean;
  isEnabled: (ctx: TimelineCommandContext) => boolean;
  execute: (ctx: TimelineCommandContext) => void | Promise<void>;
}
