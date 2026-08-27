/**
 * Track property actions
 *
 * Owns the user-intent boundary for track controls. Track controls must enter
 * the command journal so button, keyboard, and context-menu actions have the
 * same state transition, undo/redo behavior, cache invalidation, and project
 * persistence path.
 */

import { ToggleTrackPropertyCommand } from "./commands/TrackCommands";
import { useHistoryStore } from "@/store/historyStore";
import { useTimelineStore } from "@/store/timelineStore";

export type ToggleableTrackProperty = "locked" | "muted" | "solo" | "visible";

export function toggleTrackPropertyWithHistory(
  trackId: string,
  property: ToggleableTrackProperty,
): boolean {
  const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId);
  if (!track) return false;

  // Preserve the editing contract already enforced by the timeline store:
  // locking a track prevents changes that affect its audio contribution.
  if (track.locked && (property === "muted" || property === "solo")) return false;

  useHistoryStore.getState().execute(new ToggleTrackPropertyCommand(trackId, property));
  return true;
}
