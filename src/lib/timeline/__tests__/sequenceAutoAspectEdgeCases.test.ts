import { describe, it, expect, vi } from 'vitest';
import { autoAdaptSequenceForFirstVisualClip } from '../sequenceAutoAspect';
import type { Project, MediaAsset, Clip } from '@/types';

describe('Sequence Auto Aspect Ratio Edge Cases', () => {

  const createMockProject = (): Project => ({
    id: 'proj-1',
    name: 'Untitled Project',
    aspectRatio: '16:9',
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 10,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const createMockAsset = (type: 'video' | 'image' | 'audio', width = 1080, height = 1920): MediaAsset => ({
    id: 'asset-1',
    name: 'test_media',
    type,
    path: '/path/to/file',

    duration: 10,
    width,
    height,
    size: 1024,
  });


  it('auto-adapts 16:9 project to 9:16 when first clip is portrait video (1080x1920)', () => {
    const project = createMockProject();
    const asset = createMockAsset('video', 1080, 1920);
    const updateProject = vi.fn();

    autoAdaptSequenceForFirstVisualClip({
      project,
      existingClips: [],
      asset,
      updateProject,
    });

    expect(updateProject).toHaveBeenCalledWith({
      aspectRatio: '9:16',
      canvasWidth: 1080,
      canvasHeight: 1920,
    });
  });

  it('ignores auto-adapt when timeline already contains existing clips', () => {
    const project = createMockProject();
    const existingClip: Clip = {
      id: 'clip-1',
      trackId: 't1',
      mediaId: 'm1',
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      kind: 'video',
      volume: 1,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    };
    const asset = createMockAsset('video', 1080, 1920);
    const updateProject = vi.fn();

    autoAdaptSequenceForFirstVisualClip({
      project,
      existingClips: [existingClip],
      asset,
      updateProject,
    });

    expect(updateProject).not.toHaveBeenCalled();
  });

  it('ignores auto-adapt for audio media assets', () => {
    const project = createMockProject();
    const asset = createMockAsset('audio', 0, 0);
    const updateProject = vi.fn();

    autoAdaptSequenceForFirstVisualClip({
      project,
      existingClips: [],
      asset,
      updateProject,
    });

    expect(updateProject).not.toHaveBeenCalled();
  });

  it('handles invalid 0x0 visual media dimensions safely without crashing', () => {
    const project = createMockProject();
    const asset = createMockAsset('video', 0, 0);
    const updateProject = vi.fn();

    autoAdaptSequenceForFirstVisualClip({
      project,
      existingClips: [],
      asset,
      updateProject,
    });

    expect(updateProject).not.toHaveBeenCalled();
  });

});
