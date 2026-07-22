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
});
