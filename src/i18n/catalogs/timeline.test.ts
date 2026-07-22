import { describe, expect, test } from "vitest";

import { t } from "@/i18n";

const translate = t as (key: string) => string;

describe("timeline history localization", () => {
  test("translates command and transaction labels", () => {
    expect([
      translate("timeline.history.deleteClip"),
      translate("timeline.history.restoreRippleDelete"),
      translate("timeline.history.toggleTrackVisible"),
      translate("timeline.transaction.deleteClips"),
      translate("timeline.transaction.deleteLeftAtPlayhead"),
      translate("timeline.transaction.deleteRightAtPlayhead"),
    ]).toEqual([
      "删除片段",
      "恢复波纹删除",
      "切换轨道可见性",
      "删除片段",
      "删除播放头左侧",
      "删除播放头右侧",
    ]);
  });

  test("translates default track names and timeline operation errors", () => {
    expect([
      translate("timeline.track.video"),
      translate("timeline.track.audio"),
      translate("timeline.track.text"),
      translate("timeline.track.sticker"),
      translate("timeline.track.filter"),
      translate("timeline.track.videoEffect"),
      translate("timeline.track.bodyEffect"),
      translate("timeline.track.animatedOverlay"),
      translate("timeline.error.transition.selectTwoClips"),
      translate("timeline.error.swap.notEnoughSpace"),
      translate("timeline.message.splitFailed"),
    ]).toEqual([
      "视频轨道 {{number}}",
      "音频轨道 {{number}}",
      "文字轨道 {{number}}",
      "贴纸轨道 {{number}}",
      "滤镜轨道 {{number}}",
      "视频特效轨道 {{number}}",
      "人体特效轨道 {{number}}",
      "动画叠加轨道 {{number}}",
      "请选择两个片段以添加转场",
      "空间不足，交换后片段会重叠",
      "拆分失败",
    ]);
  });

  test("translates timeline track UI without changing the import shortcut", () => {
    expect([
      translate("timeline.ui.track"),
      translate("timeline.ui.dropMedia"),
      translate("timeline.ui.createTrack"),
      translate("timeline.ui.newTrack"),
      translate("timeline.ui.noTracks"),
      translate("timeline.ui.locked"),
      translate("timeline.trackControl.lock"),
      translate("timeline.trackControl.unlock"),
      translate("timeline.trackControl.hide"),
      translate("timeline.trackControl.show"),
      translate("timeline.trackControl.mute"),
      translate("timeline.trackControl.unmute"),
      t("timeline.trackControl.select", { name: "客户 Track 7" }),
      translate("timeline.trackControl.pack"),
      translate("timeline.trackControl.packTitle"),
    ]).toEqual([
      "轨道",
      "将媒体拖放到此处 • 按 I 导入",
      "新建轨道",
      "新轨道",
      "暂无轨道",
      "已锁定",
      "锁定轨道",
      "解锁轨道",
      "隐藏轨道",
      "显示轨道",
      "静音轨道",
      "取消静音",
      "选择轨道 客户 Track 7",
      "收紧轨道（移除间隙）",
      "收紧轨道 - 移除所有未保护间隙",
    ]);
  });

  test("translates timeline toolbar labels and zoom description", () => {
    expect([
      translate("timeline.toolbar.undo"),
      translate("timeline.toolbar.redo"),
      translate("timeline.toolbar.swap"),
      translate("timeline.toolbar.deleteLeft"),
      translate("timeline.toolbar.deleteRight"),
      translate("timeline.toolbar.splitAll"),
      translate("timeline.toolbar.rippleMode"),
      translate("timeline.toolbar.deleteSelected"),
      translate("timeline.toolbar.duplicateSelected"),
      translate("timeline.toolbar.closeGaps"),
      translate("timeline.toolbar.zoomOut"),
      translate("timeline.toolbar.zoomIn"),
      translate("timeline.toolbar.zoomSlider"),
    ]).toEqual([
      "撤销 (Cmd+Z)",
      "重做 (Cmd+Shift+Z)",
      "交换所选片段 (Ctrl+Shift+S)",
      "删除播放头左侧 (Q)",
      "删除播放头右侧 (W)",
      "拆分播放头处全部片段 (S)",
      "波纹模式 (R)：影响拖动、裁剪和删除操作",
      "删除所选片段",
      "复制所选片段 (Cmd/Ctrl+D)",
      "消除间隙",
      "缩小时间线",
      "放大时间线",
      "时间线缩放",
    ]);

    expect(t("timeline.toolbar.zoomValue", {
      zoom: "1.25",
      spatialTier: "标准",
      temporalTier: "编辑采样",
      cadence: "100 毫秒",
    })).toBe("缩放 1.25 倍，空间层级：标准，时间层级：编辑采样，采样间隔：100 毫秒");
  });

  test("translates every timeline toolbar toast without plural branches", () => {
    expect([
      translate("timeline.toast.split.none"),
      t("timeline.toast.split.count", { count: 2 }),
      translate("timeline.toast.deleteLeft.none"),
      t("timeline.toast.deleteLeft.count", { count: 2 }),
      translate("timeline.toast.deleteRight.none"),
      t("timeline.toast.deleteRight.count", { count: 2 }),
      t("timeline.toast.deleted.count", { count: 2 }),
      t("timeline.toast.duplicated.count", { count: 2 }),
      translate("timeline.toast.closedGaps"),
    ]).toEqual([
      "播放头下方没有可拆分的片段",
      "已拆分 2 个片段",
      "播放头左侧没有可删除的片段",
      "已删除播放头左侧 2 个片段",
      "播放头右侧没有可删除的片段",
      "已删除播放头右侧 2 个片段",
      "已删除 2 个片段",
      "已复制 2 个片段",
      "已消除时间线间隙",
    ]);
  });
});
