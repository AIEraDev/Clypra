import { describe, it, expect, beforeEach } from 'vitest';
import { resetAllProjectState } from '../ProjectStateReset';
import { useTimelineStore } from '@/store/timelineStore';
import { useUIStore } from '@/store/uiStore';

describe('Project State Reset & Cross-Project Leak Prevention', () => {

  beforeEach(() => {
    // Populate dummy state
    useTimelineStore.setState({
      tracks: [{ id: 't1', type: 'video', name: 'Track 1', visible: true, locked: false, muted: false, height: 52 }],
      clips: [{
        id: 'c1',
        trackId: 't1',
        mediaId: 'm1',
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        kind: 'video',
        volume: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      }],
    });

    useUIStore.setState({ selectedClipIds: ['c1'] });
  });

  describe('Centralized Reset Execution', () => {
    it('executes full project state cleanup without throwing unhandled errors', async () => {
      const result = await resetAllProjectState();
      expect(result.success).toBe(true);
      expect(result.resetSubsystems.length).toBeGreaterThan(0);
    });

    it('handles multiple rapid re-entrant reset calls safely', async () => {
      const results = await Promise.all([
        resetAllProjectState(),
        resetAllProjectState(),
        resetAllProjectState(),
      ]);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('clears UI selections when project is closed', async () => {
      expect(useUIStore.getState().selectedClipIds.length).toBe(1);
      await resetAllProjectState({ resetUI: true });
      expect(useUIStore.getState().selectedClipIds.length).toBe(0);
    });
  });

});
