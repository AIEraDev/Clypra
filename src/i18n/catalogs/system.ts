import { defineMessages } from "../types";

export const systemMessages = defineMessages({
  "system.updateCheckFailed": {
    en: "Update check failed",
    zhCN: "检查更新失败",
  },
  "system.updateInstallFailed": {
    en: "Failed to install update",
    zhCN: "安装更新失败",
  },
  "system.updateNoPublishedReleases": {
    en: "No published releases are available. Auto-updates will work after the first release is published on GitHub.",
    zhCN: "暂无已发布版本。首个版本发布到 GitHub 后，自动更新即可使用。",
  },
  "system.updateConnectionFailed": {
    en: "Unable to connect to the update server. Please check your internet connection.",
    zhCN: "无法连接更新服务器。请检查网络连接。",
  },
  "system.updateObjectMissing": {
    en: "No update object was provided",
    zhCN: "未提供更新对象",
  },
  "system.notTauriDesktop": {
    en: "Not running in the Tauri desktop environment",
    zhCN: "当前未在 Tauri 桌面环境中运行",
  },
  "system.export.title": { en: "Export Video", zhCN: "导出视频" },
  "system.export.preset.title": { en: "Export Preset", zhCN: "导出预设" },
  "system.export.preset.720pFast": { en: "720p Fast", zhCN: "720p 快速" },
  "system.export.preset.1080pFast": { en: "1080p Fast", zhCN: "1080p 快速" },
  "system.export.preset.1080pQuality": {
    en: "1080p Quality",
    zhCN: "1080p 高质量",
  },
  "system.export.preset.4kQuality": { en: "4K Quality", zhCN: "4K 高质量" },
  "system.export.preset.prores422hq": {
    en: "ProRes 422 HQ",
    zhCN: "ProRes 422 HQ",
  },
  "system.export.tier.fast": { en: "Fast", zhCN: "快速" },
  "system.export.tier.quality": { en: "Quality", zhCN: "高质量" },
  "system.export.tier.professional": {
    en: "Professional",
    zhCN: "专业级",
  },
  "system.export.ffmpeg.checking": {
    en: "Checking FFmpeg…",
    zhCN: "正在检查 FFmpeg…",
  },
  "system.export.ffmpeg.ready": { en: "FFmpeg ready", zhCN: "FFmpeg 已就绪" },
  "system.export.ffmpeg.missing": { en: "FFmpeg missing", zhCN: "缺少 FFmpeg" },
  "system.export.ffmpeg.installPath": {
    en: "Install FFmpeg and add it to PATH",
    zhCN: "请安装 FFmpeg 并将其加入 PATH",
  },
  "system.export.ffmpeg.required": {
    en: "FFmpeg is required",
    zhCN: "需要 FFmpeg",
  },
  "system.export.ffmpeg.requiredDescription": {
    en: "Video export requires FFmpeg to be installed and available in your system PATH.",
    zhCN: "导出视频需要安装 FFmpeg，并确保可从系统 PATH 调用。",
  },
  "system.export.project.title": { en: "Project", zhCN: "项目" },
  "system.export.project.name": { en: "Name", zhCN: "名称" },
  "system.export.project.saveName": { en: "Save Name", zhCN: "保存名称" },
  "system.export.project.rename": {
    en: "Click to rename project",
    zhCN: "点击重命名项目",
  },
  "system.export.project.duration": { en: "Duration", zhCN: "时长" },
  "system.export.project.canvas": { en: "Canvas", zhCN: "画布" },
  "system.export.project.frameRate": { en: "Frame Rate", zhCN: "帧率" },
  "system.export.settings.title": { en: "Export Settings", zhCN: "导出设置" },
  "system.export.settings.resolution": { en: "Resolution", zhCN: "分辨率" },
  "system.export.settings.codec": { en: "Codec", zhCN: "编码器" },
  "system.export.settings.quality": { en: "Quality", zhCN: "质量" },
  "system.export.settings.pixelFormat": { en: "Pixel Format", zhCN: "像素格式" },
  "system.export.settings.estimatedSize": {
    en: "Est. File Size",
    zhCN: "预计文件大小",
  },
  "system.export.mobile.title": { en: "Mobile Export", zhCN: "移动端导出" },
  "system.export.mobile.onDeviceTitle": {
    en: "On-Device Rendering Available",
    zhCN: "可在设备上渲染",
  },
  "system.export.mobile.onDeviceDescription": {
    en: "This device supports hardware-accelerated video encoding (WebCodecs). Your video will render locally on-device and can be shared or saved to your photo library.",
    zhCN: "此设备支持硬件加速视频编码（WebCodecs）。视频将在本机渲染，可分享或保存到照片图库。",
  },
  "system.export.mobile.cloudTitle": {
    en: "Cloud Rendering Fallback",
    zhCN: "改用云端渲染",
  },
  "system.export.mobile.cloudDescription": {
    en: "On-device hardware encoding is unsupported or disabled. We will render your project securely on our Cloud Render Worker service and download the finished MP4 video.",
    zhCN: "设备不支持或未启用硬件编码。项目将由云端渲染服务安全处理，并下载完成的 MP4 视频。",
  },
  "system.export.mobile.projectTitle": {
    en: "Project File Export Fallback",
    zhCN: "改为导出项目文件",
  },
  "system.export.mobile.projectDescription": {
    en: "On-device encoding and Cloud Rendering are currently unavailable. You can export the project metadata file (.clypra) and open it on Clypra Desktop to render it at full quality.",
    zhCN: "设备编码与云端渲染目前均不可用。可导出项目元数据文件（.clypra），再用 Clypra 桌面版以完整质量渲染。",
  },
  "system.export.output.title": { en: "Output", zhCN: "输出" },
  "system.export.output.none": {
    en: "No output file selected…",
    zhCN: "尚未选择输出文件…",
  },
  "system.export.output.browse": { en: "Browse", zhCN: "浏览" },
  "system.export.empty.title": { en: "No content to export", zhCN: "没有可导出的内容" },
  "system.export.empty.description": {
    en: "Add clips to the timeline before exporting.",
    zhCN: "请先向时间线添加片段，再执行导出。",
  },
  "system.export.action.exportVideo": { en: "Export Video", zhCN: "导出视频" },
  "system.export.action.cloudRender": {
    en: "Cloud Render Video",
    zhCN: "云端渲染视频",
  },
  "system.export.action.exportProject": {
    en: "Export Project File",
    zhCN: "导出项目文件",
  },
  "system.export.action.export": { en: "Export", zhCN: "导出" },
  "system.export.action.cancelExport": { en: "Cancel Export", zhCN: "取消导出" },
  "system.export.action.revealFinder": {
    en: "Reveal in Finder",
    zhCN: "在 Finder 中显示",
  },
  "system.export.action.exportAnother": { en: "Export Another", zhCN: "再次导出" },
  "system.export.action.done": { en: "Done", zhCN: "完成" },
  "system.export.action.tryAgain": { en: "Try Again", zhCN: "重试" },
  "system.export.progress.exporting": {
    en: "Exporting Video…",
    zhCN: "正在导出视频…",
  },
  "system.export.progress.percent": { en: "percent", zhCN: "百分比" },
  "system.export.progress.frames": { en: "Frames", zhCN: "帧数" },
  "system.export.progress.speed": { en: "Speed", zhCN: "速度" },
  "system.export.progress.timeRemaining": {
    en: "Time Remaining",
    zhCN: "剩余时间",
  },
  "system.export.complete.title": { en: "Export Complete!", zhCN: "导出完成！" },
  "system.export.complete.description": {
    en: "Your video has been successfully generated and saved to your device.",
    zhCN: "视频已成功生成并保存到设备。",
  },
  "system.export.complete.totalTime": {
    en: "Total Render Time",
    zhCN: "总渲染时间",
  },
  "system.export.complete.renderedFrames": {
    en: "Rendered Frames",
    zhCN: "已渲染帧数",
  },
  "system.export.complete.frameCount": { en: "{{count}} frames", zhCN: "{{count}} 帧" },
  "system.export.complete.averageSpeed": { en: "Average Speed", zhCN: "平均速度" },
  "system.export.complete.sharedFile": { en: "Shared File", zhCN: "已分享文件" },
  "system.export.complete.savedPath": { en: "Saved Path", zhCN: "保存路径" },
  "system.export.failed.title": { en: "Export Failed", zhCN: "导出失败" },
  "system.export.failed.description": {
    en: "An error occurred during the rendering and encoding process.",
    zhCN: "渲染和编码过程中发生错误。",
  },
  "system.export.failed.detail": { en: "Export failed: {{error}}", zhCN: "导出失败：{{error}}" },
  "system.export.cloud.failed": {
    en: "Cloud rendering failed: {{error}}",
    zhCN: "云端渲染失败：{{error}}",
  },
  "system.export.noFrames": { en: "No frames to export", zhCN: "没有可导出的帧" },
  "system.export.videoAcquireFailed": {
    en: "Failed to acquire video for the clip at time {{time}}s: {{error}}. Export aborted to prevent corrupted output.",
    zhCN: "无法获取时间 {{time}}s 处片段的视频：{{error}}。为防止输出损坏，导出已中止。",
  },
  "system.export.mobile.mixingAudio": { en: "Mixing audio…", zhCN: "正在混合音频…" },
  "system.export.mobile.encodingVideoFrame": {
    en: "Encoding video frame {{current}}/{{total}}…",
    zhCN: "正在编码视频帧 {{current}}/{{total}}…",
  },
  "system.export.mobile.encodingAudio": {
    en: "Encoding audio track…",
    zhCN: "正在编码音轨…",
  },
  "system.export.mobile.finalizingMP4": {
    en: "Finalizing MP4 file…",
    zhCN: "正在完成 MP4 文件…",
  },
  "system.export.mobile.sharingVideo": {
    en: "Sharing video file…",
    zhCN: "正在分享视频文件…",
  },
  "system.export.cloud.connecting": {
    en: "Connecting to Cloud Render service…",
    zhCN: "正在连接云端渲染服务…",
  },
  "system.export.cloud.uploadingProject": {
    en: "Uploading project description…",
    zhCN: "正在上传项目描述…",
  },
  "system.export.cloud.uploadingAssets": {
    en: "Uploading media assets…",
    zhCN: "正在上传媒体资源…",
  },
  "system.export.cloud.rendering": {
    en: "Cloud rendering frames (headless)…",
    zhCN: "云端正在渲染帧（无界面模式）…",
  },
  "system.export.cloud.finalizing": {
    en: "Finalizing composition…",
    zhCN: "正在完成合成…",
  },
  "system.export.cloud.downloading": {
    en: "Downloading rendered video…",
    zhCN: "正在下载渲染后的视频…",
  },
  "system.export.cloud.retrieveFailed": {
    en: "Failed to retrieve cloud-rendered video",
    zhCN: "获取云端渲染视频失败",
  },
  "system.export.defaultVideoName": { en: "video", zhCN: "视频" },
  "system.export.defaultProjectName": { en: "video-project", zhCN: "视频项目" },
  "system.export.defaultCloudName": { en: "video-cloud", zhCN: "云端视频" },
  "system.export.defaultMobileName": { en: "video-export", zhCN: "视频导出" },
  "system.export.videoFilterName": { en: "Video", zhCN: "视频" },
});
