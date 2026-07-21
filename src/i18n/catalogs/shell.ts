import { defineMessages } from "../types";

export const shellMessages = defineMessages({
  "app.loading": { en: "Loading…", zhCN: "正在加载…" },
  "app.applicationError": { en: "Application Error", zhCN: "应用程序错误" },
  "app.applicationUnexpectedError": {
    en: "Something went wrong. The application encountered an unexpected error.",
    zhCN: "出现问题。应用程序遇到了意外错误。",
  },
  "app.restartApplication": {
    en: "Restart Application",
    zhCN: "重新启动应用程序",
  },
  "app.somethingWentWrong": {
    en: "Something went wrong",
    zhCN: "出现问题",
  },
  "app.unexpectedError": {
    en: "An unexpected error occurred.",
    zhCN: "发生了意外错误。",
  },
  "app.unknownError": { en: "Unknown error", zhCN: "未知错误" },

  "project.openFailed": {
    en: "Failed to open project",
    zhCN: "打开项目失败",
  },
  "project.restoreFailed": {
    en: "Failed to restore session",
    zhCN: "恢复会话失败",
  },
  "project.defaultText": { en: "Text", zhCN: "文本" },
  "project.defaultFilter": { en: "Filter", zhCN: "滤镜" },
  "project.renamed": { en: "Project renamed", zhCN: "项目已重命名" },
  "project.renameFailed": {
    en: "Failed to rename project",
    zhCN: "重命名项目失败",
  },
  "project.deleteFailed": {
    en: "Failed to delete project",
    zhCN: "删除项目失败",
  },
  "project.saved": { en: "Project saved", zhCN: "项目已保存" },
  "project.saveBeforeCloseFailed": {
    en: "Failed to save before closing",
    zhCN: "关闭前保存失败",
  },

  "launch.logoAlt": { en: "Clypra logo", zhCN: "Clypra 标志" },
  "launch.videoEditor": { en: "Video Editor", zhCN: "视频编辑器" },
  "launch.performanceDiagnostics": {
    en: "Performance Diagnostics",
    zhCN: "性能诊断",
  },
  "launch.createSomethingAmazing": {
    en: "Create something amazing",
    zhCN: "创作精彩内容",
  },
  "launch.startNewProject": {
    en: "Start a new project",
    zhCN: "开始新项目",
  },
  "launch.startDescription": {
    en: "Begin with a 16:9 landscape canvas, or capture your screen and face simultaneously.",
    zhCN: "从 16:9 横向画布开始，或同时录制屏幕和摄像头。",
  },
  "launch.createProject": { en: "Create Project", zhCN: "新建项目" },
  "launch.recordScreenAndCamera": {
    en: "Record Screen & Camera",
    zhCN: "录制屏幕和摄像头",
  },
  "launch.recentProjects": { en: "Recent Projects", zhCN: "最近项目" },
  "launch.noRecentProjects": {
    en: "No recent projects",
    zhCN: "暂无最近项目",
  },
  "launch.noRecentProjectsDescription": {
    en: "Create a new project to get started",
    zhCN: "新建项目即可开始",
  },
  "launch.moreOptions": { en: "More options", zhCN: "更多选项" },
  "launch.rename": { en: "Rename", zhCN: "重命名" },
  "launch.renameProject": { en: "Rename Project", zhCN: "重命名项目" },
  "launch.projectName": { en: "Project name", zhCN: "项目名称" },
  "launch.renaming": { en: "Renaming…", zhCN: "正在重命名…" },
  "launch.deleteProject": { en: "Delete Project", zhCN: "删除项目" },
  "launch.confirmDeleteProject": {
    en: "Are you sure you want to delete “{{project}}”?",
    zhCN: "确定要删除“{{project}}”吗？",
  },
  "launch.deleteProjectWarning": {
    en: "This action cannot be undone. All project data will be permanently deleted.",
    zhCN: "此操作无法撤销，所有项目数据都将被永久删除。",
  },
  "launch.deleting": { en: "Deleting…", zhCN: "正在删除…" },
  "launch.untitledProject": {
    en: "Untitled Project",
    zhCN: "未命名项目",
  },
  "launch.today": { en: "Today", zhCN: "今天" },
  "launch.yesterday": { en: "Yesterday", zhCN: "昨天" },
  "launch.daysAgo": { en: "{{count}} days ago", zhCN: "{{count}} 天前" },
  "launch.diagnostics.performanceMonitoring": {
    en: "Performance Monitoring",
    zhCN: "性能监控",
  },
  "launch.diagnostics.performanceDescription": {
    en: "Track frame rendering, timeline operations, and component performance. Use {{command}} in the console.",
    zhCN: "跟踪帧渲染、时间线操作和组件性能。在控制台中使用 {{command}}。",
  },
  "launch.diagnostics.projectLoad": {
    en: "Project Load Diagnostics",
    zhCN: "项目加载诊断",
  },
  "launch.diagnostics.projectLoadDescription": {
    en: "View a detailed breakdown of project loading phases and identify the slowest parts.",
    zhCN: "查看项目各加载阶段的详细分析，并找出耗时最长的部分。",
  },
  "launch.diagnostics.textRender": {
    en: "Text Render Tracing",
    zhCN: "文本渲染跟踪",
  },
  "launch.diagnostics.textRenderDescription": {
    en: "Enable verbose logging for the text rendering pipeline with {{command}}.",
    zhCN: "使用 {{command}} 为文本渲染流程启用详细日志。",
  },
  "launch.diagnostics.timelinePerformance": {
    en: "⏱️ Timeline Performance (Focused)",
    zhCN: "⏱️ 时间线性能（专项）",
  },
  "launch.diagnostics.timelinePerformanceDescription": {
    en: "Log timeline hydration, clip additions, and timeline mutations. Use {{command}} in the console.",
    zhCN: "记录时间线加载、片段添加和时间线变更。在控制台中使用 {{command}}。",
  },
  "launch.diagnostics.textTemplateBounds": {
    en: "📐 Text Template Bounds (Debug)",
    zhCN: "📐 文本模板边界（调试）",
  },
  "launch.diagnostics.textTemplateBoundsDescription": {
    en: "Debug text-template bounding boxes, canvas size, content bounds, and clip dimensions. Use {{command}} in the console.",
    zhCN: "调试文本模板边界框、画布大小、内容边界和片段尺寸。在控制台中使用 {{command}}。",
  },
  "launch.diagnostics.note": { en: "Note:", zhCN: "注意：" },
  "launch.diagnostics.noteDescription": {
    en: "These diagnostics output to the browser console. Open DevTools (F12 or Cmd+Option+I) to view detailed performance metrics and traces.",
    zhCN: "这些诊断信息会输出到浏览器控制台。打开开发者工具（F12 或 Cmd+Option+I）可查看详细性能指标和跟踪记录。",
  },
  "launch.diagnostics.refreshRequired": {
    en: "Refresh the page after toggling for changes to take effect.",
    zhCN: "切换后请刷新页面以使更改生效。",
  },
  "launch.diagnostics.done": { en: "Done", zhCN: "完成" },

  "recovery.title": {
    en: "Restore Unsaved Session?",
    zhCN: "恢复未保存的会话？",
  },
  "recovery.unsavedDetected": {
    en: "An unsaved session for “{{project}}” was detected.",
    zhCN: "检测到“{{project}}”的未保存会话。",
  },
  "recovery.lastSaved": {
    en: "Last saved: {{date}}",
    zhCN: "上次保存：{{date}}",
  },
  "recovery.discard": { en: "Discard", zhCN: "放弃" },
  "recovery.restoring": { en: "Restoring…", zhCN: "正在恢复…" },
  "recovery.restoreProject": {
    en: "Restore {{project}}",
    zhCN: "恢复“{{project}}”",
  },

  "closing.savingProject": {
    en: "Saving project",
    zhCN: "正在保存项目",
  },
  "closing.stoppingPreview": {
    en: "Stopping preview",
    zhCN: "正在停止预览",
  },
  "closing.cleaningResources": {
    en: "Cleaning up resources",
    zhCN: "正在清理资源",
  },
  "closing.resettingState": {
    en: "Resetting state",
    zhCN: "正在重置状态",
  },
  "closing.errorTitle": {
    en: "Error Closing Project",
    zhCN: "关闭项目时出错",
  },
  "closing.closedTitle": { en: "Project Closed", zhCN: "项目已关闭" },
  "closing.title": { en: "Closing Project", zhCN: "正在关闭项目" },
  "closing.cleanupFailed": {
    en: "Some cleanup steps failed. Please check the console for details.",
    zhCN: "部分清理步骤失败。请查看控制台了解详情。",
  },
  "closing.returningHome": {
    en: "Returning to home…",
    zhCN: "正在返回主页…",
  },
  "closing.savingAndCleaning": {
    en: "Saving “{{project}}” and cleaning up…",
    zhCN: "正在保存“{{project}}”并清理资源…",
  },
  "closing.forceClose": { en: "Force Close", zhCN: "强制关闭" },

  "recording.permissionDenied": {
    en: "Could not access camera or microphone. Check macOS System Settings → Privacy & Security.",
    zhCN: "无法访问摄像头或麦克风。请检查 macOS“系统设置”→“隐私与安全性”。",
  },
  "recording.microphonePermissionDenied": {
    en: "Could not access microphone. Check system permissions.",
    zhCN: "无法访问麦克风。请检查系统权限。",
  },
  "recording.noCamera": {
    en: "No camera hardware was detected, or permission is pending.",
    zhCN: "未检测到摄像头硬件，或权限仍待授予。",
  },
  "recording.cameraUnavailable": {
    en: "Camera access was denied or unavailable.",
    zhCN: "摄像头访问被拒绝或不可用。",
  },
  "recording.microphoneFallback": {
    en: "Microphone {{count}}",
    zhCN: "麦克风 {{count}}",
  },
  "recording.cameraFallback": {
    en: "Camera {{count}}",
    zhCN: "摄像头 {{count}}",
  },
  "recording.selectedMicrophone": {
    en: "Selected microphone: {{device}}",
    zhCN: "已选择麦克风：{{device}}",
  },
  "recording.releaseStopped": {
    en: "Recording stopped unexpectedly",
    zhCN: "录制意外停止",
  },
  "recording.screenSharingStopped": {
    en: "Screen sharing was stopped",
    zhCN: "屏幕共享已停止",
  },
  "recording.screenRecorderError": {
    en: "Screen recorder encountered an error",
    zhCN: "屏幕录制器遇到错误",
  },
  "recording.cameraRecorderError": {
    en: "Camera recorder encountered an error",
    zhCN: "摄像头录制器遇到错误",
  },
  "recording.alreadyInProgress": {
    en: "Recording is already in progress",
    zhCN: "录制已在进行中",
  },
  "recording.sourceRequired": {
    en: "At least one recording source must be enabled (screen, webcam, or audio)",
    zhCN: "必须至少启用一个录制源（屏幕、摄像头或音频）",
  },
  "recording.noActiveSession": {
    en: "No active recording session",
    zhCN: "没有正在进行的录制会话",
  },
  "recording.startFailed": {
    en: "Failed to start recording: {{error}}",
    zhCN: "启动录制失败：{{error}}",
  },
  "recording.checkPermissions": {
    en: "Check permissions.",
    zhCN: "请检查权限。",
  },
  "recording.screenCaptureEnabled": {
    en: "Screen Capture Enabled",
    zhCN: "已启用屏幕录制",
  },
  "recording.systemPickerPrompt": {
    en: "The system picker will appear when recording starts",
    zhCN: "开始录制时将显示系统选择器",
  },
  "recording.audioOnly": {
    en: "Recording Audio Only",
    zhCN: "仅录制音频",
  },
  "recording.captureScreen": { en: "Capture Screen", zhCN: "录制屏幕" },
  "recording.camera": { en: "Camera", zhCN: "摄像头" },
  "recording.microphone": { en: "Microphone", zhCN: "麦克风" },
  "recording.screenCaptureSource": {
    en: "Screen Capture Source",
    zhCN: "屏幕录制来源",
  },
  "recording.standardSystemPicker": {
    en: "Standard System Picker (Let me choose)",
    zhCN: "标准系统选择器（由我选择）",
  },
  "recording.preferEntireDisplay": {
    en: "Prefer Entire Display",
    zhCN: "优先选择整个显示器",
  },
  "recording.preferApplicationWindow": {
    en: "Prefer Application Window",
    zhCN: "优先选择应用程序窗口",
  },
  "recording.microphoneSource": {
    en: "Microphone Source",
    zhCN: "麦克风来源",
  },
  "recording.liveTesting": { en: "● Live Testing", zhCN: "● 实时测试" },
  "recording.inputLevel": { en: "Input level:", zhCN: "输入电平：" },
  "recording.noMicrophones": {
    en: "No microphone devices found.",
    zhCN: "未找到麦克风设备。",
  },
  "recording.startCapture": { en: "Start Capture", zhCN: "开始录制" },
  "recording.enableSource": {
    en: "Enable at least one source to start recording.",
    zhCN: "请至少启用一个来源以开始录制。",
  },
  "recording.opensAsProject": {
    en: "The recording will automatically open as a new project in the editor.",
    zhCN: "录制完成后会自动在编辑器中打开为新项目。",
  },
  "recording.recordingWithTime": {
    en: "REC {{time}}",
    zhCN: "录制 {{time}}",
  },
  "recording.autoSaving": { en: "Auto-saving…", zhCN: "正在自动保存…" },
  "recording.recordingScreen": {
    en: "Recording Screen",
    zhCN: "正在录制屏幕",
  },
  "recording.duration": { en: "Duration", zhCN: "时长" },
  "recording.stopCapture": { en: "Stop Capture", zhCN: "停止录制" },
  "recording.closeDialog": {
    en: "Close recording dialog",
    zhCN: "关闭录制对话框",
  },
  "recording.dismissCameraNotice": {
    en: "Dismiss camera notice",
    zhCN: "关闭摄像头提示",
  },

  "recording.previewTitle": {
    en: "Screen recording",
    zhCN: "录屏预览",
  },
  "recording.discardPreview": {
    en: "Discard preview? Files remain on disk.",
    zhCN: "要放弃预览吗？文件仍会保留在磁盘上。",
  },
  "recording.loadingPreview": {
    en: "Loading preview…",
    zhCN: "正在加载预览…",
  },
  "recording.hideCamera": { en: "Hide camera", zhCN: "隐藏摄像头" },
  "recording.showCamera": { en: "Show camera", zhCN: "显示摄像头" },
  "recording.trimmed": { en: "✂ Trimmed", zhCN: "✂ 已裁剪" },
  "recording.processing": { en: "Processing…", zhCN: "正在处理…" },
  "recording.downloadTrimmed": {
    en: "Download Trimmed",
    zhCN: "下载裁剪版本",
  },
  "recording.editMore": { en: "Edit more", zhCN: "继续编辑" },
  "recording.defaultProjectName": {
    en: "Screen Recording Project",
    zhCN: "录屏项目",
  },
  "recording.videoFilterName": { en: "Video", zhCN: "视频" },
  "recording.closePreview": {
    en: "Close recording preview",
    zhCN: "关闭录屏预览",
  },
  "recording.playPreview": { en: "Play preview", zhCN: "播放预览" },
  "recording.pausePreview": { en: "Pause preview", zhCN: "暂停预览" },

  "update.available": {
    en: "Clypra {{version}} is available",
    zhCN: "Clypra {{version}} 可用",
  },
  "update.downloading": {
    en: "Downloading update: {{percent}}%",
    zhCN: "正在下载更新：{{percent}}%",
  },
  "update.restartWhenComplete": {
    en: "The app will restart when complete",
    zhCN: "完成后应用程序将重新启动",
  },
  "update.newVersionReleased": {
    en: "A new version has been released on GitHub",
    zhCN: "GitHub 上已发布新版本",
  },
  "update.install": { en: "Update", zhCN: "更新" },
  "update.installTitle": {
    en: "Download and install update",
    zhCN: "下载并安装更新",
  },
  "update.dismissTitle": {
    en: "Dismiss update notification",
    zhCN: "关闭更新通知",
  },
  "update.releaseNotes": {
    en: "Release Notes: {{notes}}",
    zhCN: "发行说明：{{notes}}",
  },

  "download.cached": { en: "Cached", zhCN: "已缓存" },
  "download.failed": { en: "Failed", zhCN: "失败" },
  "download.downloadingAudio": {
    en: "Downloading Audio",
    zhCN: "正在下载音频",
  },
  "download.complete": { en: "Download Complete", zhCN: "下载完成" },
  "download.failedTitle": { en: "Download Failed", zhCN: "下载失败" },
  "download.audioReady": {
    en: "Audio ready for use",
    zhCN: "音频已可使用",
  },
  "download.close": {
    en: "Close download notification",
    zhCN: "关闭下载通知",
  },

  "toast.warning": { en: "Warning", zhCN: "警告" },
  "toast.dismiss": { en: "Dismiss notification", zhCN: "关闭通知" },
  "network.noConnection": {
    en: "No internet connection",
    zhCN: "无网络连接",
  },
  "network.reload": { en: "Reload", zhCN: "重新加载" },
  "shell.closeDialog": { en: "Close dialog", zhCN: "关闭对话框" },
  "shell.closeSheet": { en: "Close sheet", zhCN: "关闭底部面板" },
});
