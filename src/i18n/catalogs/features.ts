import { defineMessages } from "../types";

export const featureMessages = defineMessages({
  "features.media.importFailed": { en: "Failed to import {{file}}", zhCN: "导入 {{file}} 失败" },
  "features.media.importing": { en: "Importing…", zhCN: "正在导入…" },
  "features.media.importMedia": { en: "Import Media", zhCN: "导入媒体" },
  "features.media.emptyTitle": { en: "No media imported", zhCN: "尚未导入媒体" },
  "features.media.emptyDescription": { en: "Import videos, audio, or images to get started", zhCN: "导入视频、音频或图片即可开始" },
  "features.media.removeFromTimeline": { en: "Remove from Timeline", zhCN: "从时间线移除" },
  "features.media.addToTrack": { en: "Add to Track", zhCN: "添加到轨道" },
  "features.media.added": { en: "Added", zhCN: "已添加" },

  "features.audio.category.music": { en: "Music", zhCN: "音乐" },
  "features.audio.category.cinematic": { en: "Cinematic", zhCN: "电影感" },
  "features.audio.category.upbeat": { en: "Upbeat", zhCN: "欢快" },
  "features.audio.category.loFi": { en: "Lo-Fi", zhCN: "低保真" },
  "features.audio.category.hipHop": { en: "Hip-Hop", zhCN: "嘻哈" },
  "features.audio.category.ambient": { en: "Ambient", zhCN: "氛围" },
  "features.audio.category.sfx": { en: "Sound Effects", zhCN: "音效" },
  "features.audio.loading": { en: "Loading audio library…", zhCN: "正在加载音频库…" },
  "features.audio.emptyTitle": { en: "No approved audio yet", zhCN: "暂无已审核音频" },
  "features.audio.emptyDescription": {
    en: "Audio published from Clypra Studio will appear here after API cache refresh.",
    zhCN: "Clypra Studio 发布的音频将在 API 缓存刷新后显示于此。",
  },
  "features.audio.addToTimeline": { en: "Add to Timeline", zhCN: "添加到时间线" },
  "features.audio.downloadAndAdd": { en: "Download & Add", zhCN: "下载并添加" },
  "features.audio.loadFailed": { en: "Failed to load audio library: {{error}}", zhCN: "加载音频库失败：{{error}}" },
  "features.audio.play": { en: "Play {{name}}", zhCN: "播放 {{name}}" },
  "features.audio.pause": { en: "Pause {{name}}", zhCN: "暂停 {{name}}" },
});
