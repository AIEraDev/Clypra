import { defineMessages } from "../types";

export const editorMessages = defineMessages({
  "editor.topBar.backHome": { en: "Back to Home", zhCN: "返回首页" },
  "editor.topBar.undo": { en: "Undo", zhCN: "撤销" },
  "editor.topBar.redo": { en: "Redo", zhCN: "重做" },
  "editor.topBar.undoAction": { en: "Undo {{action}}", zhCN: "撤销 {{action}}" },
  "editor.topBar.redoAction": { en: "Redo {{action}}", zhCN: "重做 {{action}}" },

  "editor.media.nav.media": { en: "Media", zhCN: "媒体" },
  "editor.media.nav.audio": { en: "Audio", zhCN: "音频" },
  "editor.media.nav.text": { en: "Text", zhCN: "文本" },
  "editor.media.nav.stickers": { en: "Stickers", zhCN: "贴纸" },
  "editor.media.nav.effects": { en: "Effects", zhCN: "效果" },
  "editor.media.nav.filters": { en: "Filters", zhCN: "滤镜" },
  "editor.media.nav.transitions": { en: "Transitions", zhCN: "转场" },
  "editor.media.nav.captions": { en: "Captions", zhCN: "字幕" },

  "editor.mobile.importFiles": { en: "Import Files", zhCN: "导入文件" },
  "editor.mobile.mediaAssets": { en: "Media Assets", zhCN: "媒体素材" },
  "editor.mobile.addText": { en: "Add Text", zhCN: "添加文本" },
  "editor.mobile.addAudio": { en: "Add Audio", zhCN: "添加音频" },
  "editor.mobile.clipProperties": { en: "Clip Properties", zhCN: "片段属性" },
  "editor.mobile.adjust": { en: "Adjust", zhCN: "调整" },
  "editor.mobile.assetLibrary": { en: "Asset Library", zhCN: "素材库" },
  "editor.mobile.clipAdjustments": { en: "Clip Adjustments", zhCN: "片段调整" },

  "editor.properties.clipType.text": { en: "Text", zhCN: "文本" },
  "editor.properties.clipType.sticker": { en: "Sticker", zhCN: "贴纸" },
  "editor.properties.clipType.filter": { en: "Filter", zhCN: "滤镜" },
  "editor.properties.clipType.videoEffect": { en: "Video Effect", zhCN: "视频效果" },
  "editor.properties.clipType.bodyEffect": { en: "Body Effect", zhCN: "身体效果" },
  "editor.properties.clipType.animatedOverlay": { en: "Animated Overlay", zhCN: "动画叠加" },
  "editor.properties.clipType.video": { en: "Video", zhCN: "视频" },
  "editor.properties.clipType.audio": { en: "Audio", zhCN: "音频" },
  "editor.properties.clipType.image": { en: "Image", zhCN: "图像" },
  "editor.properties.clipType.clip": { en: "Clip", zhCN: "片段" },
  "editor.properties.clipType.transition": { en: "Transition", zhCN: "转场" },
  "editor.properties.tabs.textStyle": { en: "Text Style", zhCN: "文本样式" },
  "editor.properties.tabs.animation": { en: "Animation", zhCN: "动画" },
  "editor.properties.tabs.transform": { en: "Transform", zhCN: "变换" },
  "editor.properties.transition.dissolve": { en: "Dissolve Transition", zhCN: "溶解转场" },
  "editor.properties.transition.fade": { en: "Fade Transition", zhCN: "淡入淡出转场" },
  "editor.properties.durationSeconds": { en: "{{duration}} seconds", zhCN: "{{duration}} 秒" },

  "editor.fallback.text": { en: "Text", zhCN: "文本" },
  "editor.fallback.libraryAudio": { en: "Library Audio", zhCN: "素材库音频" },
  "editor.fallback.sticker": { en: "Sticker", zhCN: "贴纸" },
  "editor.fallback.filter": { en: "Filter", zhCN: "滤镜" },
  "editor.fallback.effect": { en: "Effect", zhCN: "效果" },

  "editor.toast.selectAdjacentClipsOrCut": {
    en: "Select two adjacent clips or place the playhead at a cut",
    zhCN: "请选择两个相邻片段，或将播放头置于剪切点",
  },
  "editor.toast.transitionAddedBetweenClips": {
    en: 'Added "{{name}}" between clips',
    zhCN: "已在片段间添加“{{name}}”",
  },
  "editor.toast.selectVisualClipForEffect": {
    en: "Select a video or image clip to apply this effect",
    zhCN: "请选择视频或图像片段以应用此效果",
  },
  "editor.toast.effectVisualClipsOnly": {
    en: "Effects can only be applied to video or image clips",
    zhCN: "效果仅可应用于视频或图像片段",
  },
  "editor.toast.effectAlreadyApplied": {
    en: 'Effect "{{name}}" is already applied',
    zhCN: "效果“{{name}}”已应用",
  },
  "editor.toast.effectApplied": { en: 'Applied effect "{{name}}"', zhCN: "已应用效果“{{name}}”" },
  "editor.toast.effectAdded": { en: 'Added effect "{{name}}"', zhCN: "已添加效果“{{name}}”" },
  "editor.toast.filterNotDownloaded": { en: "Filter not downloaded yet", zhCN: "滤镜尚未下载" },
  "editor.toast.filterAdded": { en: 'Added filter "{{name}}"', zhCN: "已添加滤镜“{{name}}”" },
  "editor.toast.filterAddedToTimeline": {
    en: 'Added filter "{{name}}" to the timeline',
    zhCN: "已将滤镜“{{name}}”添加到时间线",
  },
  "editor.toast.transitionError.selectTwoClips": {
    en: "Select two clips to add a transition",
    zhCN: "请选择两个片段以添加转场",
  },
  "editor.toast.transitionError.sameTrack": {
    en: "Transitions require two clips on the same track",
    zhCN: "转场需要同一轨道上的两个片段",
  },
  "editor.toast.transitionError.trackNotFound": {
    en: "Transition track was not found",
    zhCN: "未找到转场轨道",
  },
  "editor.toast.transitionError.unlockTrack": {
    en: "Unlock the track before adding a transition",
    zhCN: "添加转场前请先解锁轨道",
  },
  "editor.toast.transitionError.visualTracksOnly": {
    en: "Visual transitions can only be added to video or text tracks",
    zhCN: "视觉转场仅可添加到视频或文本轨道",
  },
  "editor.toast.transitionError.moveClipsTogether": {
    en: "Move clips together before adding a transition",
    zhCN: "添加转场前请先将片段相邻放置",
  },
  "editor.toast.transitionError.clipsTooShort": {
    en: "Clips are too short for this transition",
    zhCN: "片段过短，无法使用此转场",
  },

  "editor.audio.coverAlt": { en: "Cover art for {{name}}", zhCN: "{{name}} 的封面" },
  "editor.audio.albumArtwork": { en: "Album artwork", zhCN: "专辑封面" },
  "editor.audio.playing": { en: "Playing", zhCN: "正在播放" },
});

export const editorTransitionErrorKeys: Record<string, keyof typeof editorMessages> = {
  "Select two clips to add a transition": "editor.toast.transitionError.selectTwoClips",
  "Transitions require two clips on the same track": "editor.toast.transitionError.sameTrack",
  "Transition track was not found": "editor.toast.transitionError.trackNotFound",
  "Unlock the track before adding a transition": "editor.toast.transitionError.unlockTrack",
  "Visual transitions can only be added to video or text tracks": "editor.toast.transitionError.visualTracksOnly",
  "Move clips together before adding a transition": "editor.toast.transitionError.moveClipsTogether",
  "Clips are too short for this transition": "editor.toast.transitionError.clipsTooShort",
};
