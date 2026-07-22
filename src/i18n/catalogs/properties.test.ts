import { describe, expect, it } from "vitest";
import { t } from "@/i18n";

const translate = t as (key: string) => string;

describe("basic property messages", () => {
  it("provides localized text animation, mode, and effect style labels", () => {
    expect([
      translate("properties.textAnimation.title"),
      translate("properties.textAnimation.entrance"),
      translate("properties.textAnimation.exit"),
      translate("properties.textAnimation.duration"),
      translate("properties.textAnimation.easing"),
      translate("properties.textAnimation.easing.easeInOut"),
      translate("properties.textAnimation.preset.slideLeft"),
      translate("properties.textAnimation.preset.zoomOut"),
      translate("properties.textAnimation.previewTip"),
      translate("properties.textMode.plain"),
      translate("properties.textMode.effect"),
      translate("properties.textMode.template"),
      translate("properties.effectStyle.custom"),
      translate("properties.effectStyle.changeEffect"),
      translate("properties.effectStyle.detachEffect"),
      translate("properties.effectStyle.modifiedTip"),
    ]).toEqual([
      "文字动画",
      "入场",
      "出场",
      "时长",
      "缓动",
      "缓入缓出",
      "向左滑入",
      "缩小",
      "动画将在播放时预览",
      "纯文本",
      "文字效果",
      "模板",
      "自定义",
      "更换文字效果",
      "分离效果（保留当前样式）",
      "提示：编辑下方的字体排印或颜色将与预设效果分离。",
    ]);
  });

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
