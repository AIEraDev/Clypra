import { describe, expect, test } from "vitest";

import topBarSource from "../../components/editor/TopBar.tsx?raw";
import editorLayoutSource from "../../components/editor/EditorLayout.tsx?raw";
import mobileEditorLayoutSource from "../../components/editor/MobileEditorLayout.tsx?raw";
import propertiesPanelSource from "../../components/editor/PropertiesPanel.tsx?raw";
import enhancedMediaPanelSource from "../../components/editor/media-panel/EnhancedMediaPanel.tsx?raw";
import audioWaveformSource from "../../components/editor/media-panel/AudioWaveform.tsx?raw";
import gpuPreviewSource from "../../components/editor/preview/GPUPreview.tsx?raw";
import pixiProgramPreviewSource from "../../components/editor/preview/PixiProgramPreview.tsx?raw";
import sourcePreviewSource from "../../components/editor/preview/SourcePreview.tsx?raw";
import { t } from "@/i18n";
import * as editorCatalog from "@/i18n/catalogs/editor";
import * as appTypes from "@/types";

const translate = t as (key: string, params?: Record<string, string | number>) => string;

describe("editor shell localization", () => {
  test("translates top bar, media navigation, mobile actions, and property labels", () => {
    expect([
      translate("editor.topBar.backHome"),
      translate("editor.topBar.undo"),
      translate("editor.topBar.redo"),
      translate("editor.media.nav.media"),
      translate("editor.media.nav.audio"),
      translate("editor.media.nav.text"),
      translate("editor.media.nav.stickers"),
      translate("editor.media.nav.effects"),
      translate("editor.media.nav.filters"),
      translate("editor.media.nav.transitions"),
      translate("editor.media.nav.captions"),
      translate("editor.mobile.importFiles"),
      translate("editor.mobile.mediaAssets"),
      translate("editor.mobile.addText"),
      translate("editor.mobile.addAudio"),
      translate("editor.mobile.clipProperties"),
      translate("editor.mobile.adjust"),
      translate("editor.mobile.assetLibrary"),
      translate("editor.mobile.clipAdjustments"),
      translate("editor.properties.tabs.textStyle"),
      translate("editor.properties.tabs.animation"),
      translate("editor.properties.tabs.transform"),
    ]).toEqual([
      "返回首页",
      "撤销",
      "重做",
      "媒体",
      "音频",
      "文本",
      "贴纸",
      "效果",
      "滤镜",
      "转场",
      "字幕",
      "导入文件",
      "媒体素材",
      "添加文本",
      "添加音频",
      "片段属性",
      "调整",
      "素材库",
      "片段调整",
      "文本样式",
      "动画",
      "变换",
    ]);
  });

  test("translates clip types, transition names, and local fallbacks", () => {
    expect([
      translate("editor.properties.clipType.text"),
      translate("editor.properties.clipType.sticker"),
      translate("editor.properties.clipType.filter"),
      translate("editor.properties.clipType.videoEffect"),
      translate("editor.properties.clipType.bodyEffect"),
      translate("editor.properties.clipType.animatedOverlay"),
      translate("editor.properties.clipType.video"),
      translate("editor.properties.clipType.audio"),
      translate("editor.properties.clipType.image"),
      translate("editor.properties.clipType.clip"),
      translate("editor.properties.clipType.transition"),
      translate("editor.properties.transition.dissolve"),
      translate("editor.properties.transition.fade"),
      translate("editor.fallback.text"),
      translate("editor.fallback.libraryAudio"),
      translate("editor.fallback.sticker"),
      translate("editor.fallback.filter"),
      translate("editor.fallback.effect"),
    ]).toEqual([
      "文本",
      "贴纸",
      "滤镜",
      "视频效果",
      "身体效果",
      "动画叠加",
      "视频",
      "音频",
      "图像",
      "片段",
      "转场",
      "溶解转场",
      "淡入淡出转场",
      "文本",
      "素材库音频",
      "贴纸",
      "滤镜",
      "效果",
    ]);
  });

  test("interpolates complete Chinese messages without translating dynamic values", () => {
    expect(translate("editor.topBar.undoAction", { action: "Ripple Delete" })).toBe("撤销 Ripple Delete");
    expect(translate("editor.topBar.redoAction", { action: "Split clip #42" })).toBe("重做 Split clip #42");
    expect(translate("editor.toast.transitionAddedBetweenClips", { name: "Neon Wipe v2" })).toBe("已在片段间添加“Neon Wipe v2”");
    expect(translate("editor.toast.effectAlreadyApplied", { name: "Glitch-X" })).toBe("效果“Glitch-X”已应用");
    expect(translate("editor.toast.effectApplied", { name: "Glow/Remote" })).toBe("已应用效果“Glow/Remote”");
    expect(translate("editor.toast.filterAdded", { name: "Cine LUT 01" })).toBe("已添加滤镜“Cine LUT 01”");
    expect(translate("editor.properties.durationSeconds", { duration: "3.7" })).toBe("3.7 秒");
    expect(translate("editor.audio.coverAlt", { name: "Track_01.wav" })).toBe("Track_01.wav 的封面");
  });

  test("maps store transition errors only at the editor UI boundary", () => {
    const errorKeys = (
      editorCatalog as typeof editorCatalog & {
        editorTransitionErrorKeys?: Record<string, string>;
      }
    ).editorTransitionErrorKeys;

    expect(errorKeys).toEqual({
      "Select two clips to add a transition": "editor.toast.transitionError.selectTwoClips",
      "Transitions require two clips on the same track": "editor.toast.transitionError.sameTrack",
      "Transition track was not found": "editor.toast.transitionError.trackNotFound",
      "Unlock the track before adding a transition": "editor.toast.transitionError.unlockTrack",
      "Visual transitions can only be added to video or text tracks": "editor.toast.transitionError.visualTracksOnly",
      "Move clips together before adding a transition": "editor.toast.transitionError.moveClipsTogether",
      "Clips are too short for this transition": "editor.toast.transitionError.clipsTooShort",
    });
  });

  test("keeps stable navigation IDs out of translation", () => {
    const ids = [...enhancedMediaPanelSource.matchAll(/id: "([^"]+)" as const/g)].map((match) => match[1]);

    expect(ids).toEqual(["media", "audio", "text", "stickers", "effects", "filters", "transitions", "captions"]);
    expect(enhancedMediaPanelSource).toContain("key={tab.id}");
    expect(enhancedMediaPanelSource).toContain("setActiveTab(tab.id)");
    expect(enhancedMediaPanelSource).toContain("{t(tab.labelKey)}");
    expect(mobileEditorLayoutSource).toContain('openLibraryWithTab("media")');
    expect(mobileEditorLayoutSource).toContain('openLibraryWithTab("text")');
    expect(mobileEditorLayoutSource).toContain('openLibraryWithTab("audio")');
    expect(mobileEditorLayoutSource).toContain('openLibraryWithTab("transitions")');
  });

  test("wires localized tooltips, ARIA labels, toasts, fallbacks, and audio status", () => {
    expect(topBarSource).toContain('title={t("editor.topBar.backHome")} aria-label={t("editor.topBar.backHome")}');
    expect(topBarSource).toContain('aria-label={t("common.settings")}');
    expect(topBarSource).toContain('aria-label={t("system.export.action.export")}');
    expect(topBarSource).toContain("{project?.name}");
    expect(topBarSource).not.toContain('t(project?.name');

    expect(editorLayoutSource).toContain("editorTransitionErrorKeys[result.error]");
    expect(editorLayoutSource).toContain('item.name || t("editor.fallback.text")');
    expect(editorLayoutSource).toContain('item.name || t("editor.fallback.libraryAudio")');
    expect(editorLayoutSource).toContain('item.name || t("editor.fallback.sticker")');
    expect(editorLayoutSource).toContain('cachedFilter.filter.name || t("editor.fallback.filter")');
    expect(editorLayoutSource).toContain('item.name || t("editor.fallback.effect")');

    expect(mobileEditorLayoutSource).toContain("editorTransitionErrorKeys[result.error]");
    expect(mobileEditorLayoutSource).toContain('title={t("editor.mobile.importFiles")}');
    expect(mobileEditorLayoutSource).toContain('aria-label={t("editor.mobile.clipProperties")}');
    expect(mobileEditorLayoutSource).toContain('title={t("editor.mobile.assetLibrary")}');

    expect(propertiesPanelSource).toContain('t("editor.properties.durationSeconds", { duration: clipDuration })');
    expect(propertiesPanelSource).not.toContain("t(textClip.text");
    expect(propertiesPanelSource).not.toContain("t(selectedAsset?.name");
    expect(propertiesPanelSource).not.toContain("t(selectedClip.kind");

    expect(audioWaveformSource).toContain('t("editor.audio.coverAlt", { name: audioName })');
    expect(audioWaveformSource).toContain('alt=""');
    expect(audioWaveformSource).toContain('t("editor.audio.playing")');
  });

  test("translates source and program preview copy while preserving technical tokens", () => {
    expect([
      translate("editor.preview.source.lottieLoadFailed"),
      translate("editor.preview.source.textEffectLoadFailed"),
      translate("editor.preview.source.media.video"),
      translate("editor.preview.source.media.audio"),
      translate("editor.preview.source.media.text"),
      translate("editor.preview.source.media.image"),
      translate("editor.preview.source.close"),
      translate("editor.preview.source.inPoint"),
      translate("editor.preview.source.outPoint"),
      translate("editor.preview.source.duration"),
      translate("editor.preview.source.clearMarks"),
      translate("editor.preview.source.clear"),
      translate("editor.preview.loading"),
      translate("editor.preview.source.proceduralStyle"),
      translate("editor.preview.source.addTextToTimeline"),
      translate("editor.preview.source.addToTimeline"),
      translate("editor.preview.source.markIn"),
      translate("editor.preview.source.markOut"),
      translate("editor.preview.source.playMarkedRegion"),
      translate("editor.preview.source.play"),
      translate("editor.preview.source.addToTrack"),
      translate("editor.preview.source.add"),
      translate("editor.preview.program.title"),
      translate("editor.preview.program.webglPipeline"),
      translate("editor.preview.program.safeZones"),
      translate("editor.preview.program.noClips"),
      translate("editor.preview.program.fill"),
      translate("editor.preview.program.fit"),
      translate("editor.preview.gpu.initializing"),
      translate("editor.preview.gpu.consoleDetails"),
      translate("editor.preview.webgl.unavailable"),
      translate("editor.preview.webgl.requirement"),
    ]).toEqual([
      "Lottie 预览加载失败",
      "文字效果加载失败，请重试。",
      "视频",
      "音频",
      "文本",
      "图片",
      "关闭 (Esc)",
      "入点",
      "出点",
      "时长",
      "清除标记",
      "清除",
      "加载预览",
      "程序化样式预览",
      "将文本添加到时间线",
      "添加到时间线",
      "标记入点 (I)",
      "标记出点 (O)",
      "播放标记区域",
      "播放",
      "添加到轨道",
      "添加",
      "节目预览 (PixiJS)",
      "WebGL 管线",
      "安全区",
      "序列无片段",
      "填满预览",
      "适应预览",
      "GPU 预览正在初始化…",
      "详情请查看控制台 (F12)",
      "WebGL 不可用",
      "Clypra 需要 WebGL 才能渲染预览。请更新显卡驱动，或尝试其他浏览器。",
    ]);

    expect(translate("editor.preview.source.previewing", { mediaType: "Remote H.265" })).toBe(
      "正在预览 — Remote H.265",
    );
    expect(translate("editor.preview.source.durationSeconds", { duration: "3.70" })).toBe("3.70 秒");
    expect(translate("editor.preview.source.addDurationToTimeline", { duration: "3.70" })).toBe(
      "将 3.70 秒添加到时间线",
    );
    expect(translate("editor.preview.program.dimensionsFps", { width: 1920, height: 1080, fps: 29.97 })).toBe(
      "1920×1080 • 29.97 FPS",
    );
  });

  test("translates transport, quality, aspect, volume, telemetry, and safe-area labels", () => {
    expect([
      translate("editor.preview.transport.emptyTimeline"),
      translate("editor.preview.transport.previousFrame"),
      translate("editor.preview.transport.play"),
      translate("editor.preview.transport.pause"),
      translate("editor.preview.transport.nextFrame"),
      translate("editor.preview.speed.label"),
      translate("editor.preview.quality.label"),
      translate("editor.preview.quality.full"),
      translate("editor.preview.quality.high"),
      translate("editor.preview.quality.medium"),
      translate("editor.preview.quality.low"),
      translate("editor.preview.quality.fullDescription"),
      translate("editor.preview.quality.highDescription"),
      translate("editor.preview.quality.mediumDescription"),
      translate("editor.preview.quality.lowDescription"),
      translate("editor.preview.aspect.label"),
      translate("editor.preview.aspect.original"),
      translate("editor.preview.aspect.youtube"),
      translate("editor.preview.aspect.vertical"),
      translate("editor.preview.aspect.square"),
      translate("editor.preview.aspect.portrait"),
      translate("editor.preview.volume.mute"),
      translate("editor.preview.volume.unmute"),
      translate("editor.preview.volume.muteAudio"),
      translate("editor.preview.volume.unmuteAudio"),
      translate("editor.preview.volume.label"),
      translate("editor.preview.telemetry.title"),
      translate("editor.preview.telemetry.evaluation"),
      translate("editor.preview.telemetry.raster"),
      translate("editor.preview.telemetry.total"),
      translate("editor.preview.telemetry.cacheHitRate"),
      translate("editor.preview.telemetry.active"),
      translate("editor.preview.telemetry.droppedFrames"),
      translate("editor.preview.telemetry.maxDrift"),
      translate("editor.preview.safe.action"),
      translate("editor.preview.safe.title"),
    ]).toEqual([
      "时间线上无片段",
      "上一帧",
      "播放",
      "暂停",
      "下一帧",
      "播放速度",
      "播放质量",
      "完整质量",
      "高质量",
      "中等质量",
      "低质量",
      "原始视频分辨率",
      "流畅播放，不影响导出视频",
      "更流畅播放，不影响导出视频",
      "最流畅播放，不影响导出视频",
      "预览宽高比",
      "原始",
      "16:9（YouTube）",
      "9:16（Reels/Shorts）",
      "1:1（Instagram）",
      "4:5（Instagram）",
      "静音",
      "取消静音",
      "将音频静音",
      "取消音频静音",
      "音量",
      "渲染遥测",
      "评估",
      "栅格化",
      "总计",
      "缓存命中率",
      "活动数",
      "丢帧",
      "最大漂移",
      "动作安全区 (90%)",
      "标题安全区 (80%)",
    ]);
    expect(translate("editor.preview.speed.current", { speed: 1.25 })).toBe("播放速度：1.25x");
    expect(translate("editor.preview.quality.current", { quality: "中等质量" })).toBe("播放质量：中等质量");
    expect(translate("editor.preview.aspect.current", { aspect: "原始" })).toBe("预览宽高比：原始");
  });

  test("keeps aspect preset IDs stable and stores only message keys in shared types", () => {
    const labels = (
      appTypes as typeof appTypes & {
        PREVIEW_ASPECT_MESSAGE_KEY?: Record<string, string>;
      }
    ).PREVIEW_ASPECT_MESSAGE_KEY;

    expect(labels).toEqual({
      original: "editor.preview.aspect.original",
      "16:9": "editor.preview.aspect.youtube",
      "9:16": "editor.preview.aspect.vertical",
      "1:1": "editor.preview.aspect.square",
      "4:5": "editor.preview.aspect.portrait",
    });
  });

  test("wires heavy preview surfaces to complete localized messages", () => {
    expect(sourcePreviewSource).toContain('t("editor.preview.source.previewing", { mediaType:');
    expect(sourcePreviewSource).toContain('t("editor.preview.source.textEffectLoadFailed")');
    expect(sourcePreviewSource).toContain('title={t("editor.preview.source.close")}');
    expect(sourcePreviewSource).toContain('aria-label={t("editor.preview.source.close")}');
    expect(sourcePreviewSource).not.toContain("Loading preview...");

    expect(pixiProgramPreviewSource).toContain('t("editor.preview.program.dimensionsFps", {');
    expect(pixiProgramPreviewSource).toContain('title={scaleModeLabel}');
    expect(pixiProgramPreviewSource).toContain('aria-label={scaleModeLabel}');
    expect(pixiProgramPreviewSource).not.toContain("No clips in sequence");

    expect(gpuPreviewSource).toContain('t("editor.preview.gpu.initializing")');
    expect(gpuPreviewSource).toContain('t("editor.preview.gpu.consoleDetails")');
  });
});
