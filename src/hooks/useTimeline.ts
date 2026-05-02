import { useTimelineStore } from '../store/timelineStore'
import { useProjectStore } from '../store/projectStore'
import type { Clip, MediaAsset } from '../types'
import { createClipFromAsset } from '../lib/timelineClip'

export const useTimeline = () => {
  const { tracks, clips, zoomLevel, scrollLeft, pixelsPerSecond, addClip, removeClip, updateClip, moveClip, setZoom, setScrollLeft } = useTimelineStore()
  const { mediaAssets, project } = useProjectStore()

  const addClipFromAsset = (asset: MediaAsset, trackId: string, startTime: number) => {
    const clip: Clip = createClipFromAsset({
      asset,
      trackId,
      startTime,
      width: project?.canvasWidth || 1920,
      height: project?.canvasHeight || 1080,
    })
    addClip(clip)
  }

  const getClipsForTrack = (trackId: string) => {
    return clips.filter((c) => c.trackId === trackId)
  }

  const getMediaAsset = (mediaId: string) => {
    return mediaAssets.find((a) => a.id === mediaId)
  }

  return {
    tracks,
    clips,
    zoomLevel,
    scrollLeft,
    pixelsPerSecond,
    addClip,
    removeClip,
    updateClip,
    moveClip,
    setZoom,
    setScrollLeft,
    addClipFromAsset,
    getClipsForTrack,
    getMediaAsset,
  }
}
