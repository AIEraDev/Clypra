import { describe, expect, it } from "vitest";
import { t } from "@/i18n";

const translate = t as (key: string) => string;

describe("basic property messages", () => {
  it("provides localized empty, audio, transition, effect, and sticker labels", () => {
    expect([
      translate("properties.title"),
      translate("properties.empty.selectClipTitle"),
      translate("properties.empty.addMediaTitle"),
      translate("properties.audio.volume"),
      translate("properties.audio.mute"),
      translate("properties.audio.fadeIn"),
      translate("properties.transition.settings"),
      translate("properties.transition.type.fade"),
      translate("properties.transition.easing.easeInOut"),
      translate("properties.transition.remove"),
      translate("properties.timelineEffect.filterSettings"),
      translate("properties.timelineEffect.bodyEffect"),
      translate("properties.timelineEffect.intensity"),
      translate("properties.sticker.animation"),
      translate("properties.sticker.speed"),
      translate("properties.sticker.enabled"),
    ]).toEqual([
      "属性",
      "选择片段进行编辑",
      "将媒体添加到时间线",
      "音量",
      "静音",
      "淡入",
      "转场设置",
      "淡入淡出",
      "缓入缓出",
      "删除转场",
      "滤镜设置",
      "身体效果",
      "强度",
      "贴纸动画",
      "速度",
      "已启用",
    ]);
  });

  it("provides localized transform and applied effect labels", () => {
    expect([
      translate("properties.transform.title"),
      translate("properties.transform.conformMode"),
      translate("properties.transform.mode.fit"),
      translate("properties.transform.center"),
      translate("properties.transform.flipHorizontal"),
      translate("properties.transform.timing"),
      translate("properties.effects.appliedFilter"),
      translate("properties.effects.removeFilter"),
      translate("properties.effects.videoEffects"),
      translate("properties.effects.removeEffect"),
      translate("properties.effects.intensity"),
    ]).toEqual([
      "变换",
      "适配模式",
      "适应",
      "居中",
      "水平翻转",
      "时间",
      "已应用滤镜",
      "删除滤镜",
      "视频效果",
      "删除效果",
      "强度",
    ]);
  });
});
