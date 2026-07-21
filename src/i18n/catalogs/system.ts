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
});
