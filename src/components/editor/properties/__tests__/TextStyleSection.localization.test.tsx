import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextClip } from "@/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { useTemplateStore } from "@/features/text-templates/templateStore";
import { TextStyleSection } from "../TextStyleSection";

const baseClip = {
  id: "text-1",
  trackId: "track-1",
  mediaId: "text-media-1",
  startTime: 0,
  duration: 4,
  trimIn: 0,
  trimOut: 4,
  x: 0,
  y: 0,
  width: 640,
  height: 180,
  opacity: 1,
  rotation: 0,
  kind: "text",
  text: "User Text Input",
  fontFamily: "Arial",
  fontSize: 48,
  fontWeight: 400,
  fontStyle: "normal",
  color: "#ff3b30",
  align: "center",
  valign: "middle",
  lineHeight: 1.2,
  letterSpacing: 0,
  paddingX: 0,
  paddingY: 0,
} as TextClip;

const effect = {
  id: "raw-effect-id",
  name: "Raw Effect Name",
  category: "neon",
  font: { family: "Arial", weight: 400, style: "normal" },
  fills: [{ color: "#ff3b30" }],
} as any;

const templates = [
  { id: "raw-template-id", label: "Raw Template Label", category: "lower-third", thumbnail: "", templateData: { layers: [] } },
  { id: "second-template-id", label: "Second Raw Template", category: "lower-third", thumbnail: "", templateData: { layers: [] } },
  { id: "caption-template-id", label: "Caption Raw Template", category: "caption", thumbnail: "", templateData: { layers: [] } },
] as any[];

const renderSection = (textClip: TextClip, overrides: Record<string, unknown> = {}) => {
  const props = {
    textClip,
    presets: [{ id: "raw-preset-id", name: "Raw Preset Name", isCustom: true, fontFamily: "Arial", color: "#ff3b30" }],
    newPresetName: "User Style Name",
    setNewPresetName: vi.fn(),
    handleUpdate: vi.fn(),
    handleUpdateMultiple: vi.fn(),
    handleApplyPreset: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    ...overrides,
  };

  return { ...render(<TextStyleSection {...props} />), props };
};

describe("TextStyleSection localization", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: { [effect.id]: effect } });
    useTemplateStore.setState({ templates });
  });

  it("displays built-in preset labels in Chinese while applying the original object", () => {
    const preset = {
      id: "preset-neon",
      name: "Neon Glow",
      fontFamily: "Outfit Variable",
      color: "#ff007f",
    };
    const handleApplyPreset = vi.fn();
    const { props } = renderSection(baseClip, { presets: [preset], handleApplyPreset });

    fireEvent.click(screen.getByRole("button", { name: "霓虹光效" }));
    expect(props.handleApplyPreset).toHaveBeenCalledWith(preset);
    expect(preset.name).toBe("Neon Glow");
  });

  it("localizes the plain editor while preserving names, values, units, and user input", () => {
    const { props } = renderSection({ ...baseClip, textRole: "caption" });

    expect(screen.getByText("文本内容")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("CLYPRA")).toHaveValue("User Text Input");
    expect(screen.getByRole("button", { name: "样式预设" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("自定义样式名称...")).toHaveValue("User Style Name");
    expect(screen.getByRole("button", { name: "Raw Preset Name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除样式 Raw Preset Name" })).toHaveAttribute("title", "删除样式 Raw Preset Name");
    expect(screen.getByRole("button", { name: "保存样式" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "系统字体" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Arial" })).toHaveValue("Arial");
    expect(screen.getByRole("group", { name: "网络字体" })).toBeInTheDocument();
    expect(screen.queryByText("Regular (400)")).not.toBeInTheDocument();
    expect(screen.getByText("常规 (400)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "关闭" })).toHaveLength(3);
    expect(screen.getByRole("option", { name: "纯色" })).toHaveValue("solid");
    expect(screen.getByRole("option", { name: "金色渐变" })).toHaveValue("#ffe066, #b38600");
    expect(screen.getByTitle("白色")).toHaveAccessibleName("白色");
    expect(screen.getByText("48px")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "左对齐" }));
    expect(props.handleUpdate).toHaveBeenCalledWith("align", "left");
    fireEvent.click(screen.getByTitle("白色"));
    expect(props.handleUpdateMultiple).toHaveBeenCalledWith({ color: "#ffffff" });

    expect(screen.getByText("Raw Effect Name")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索效果..."), { target: { value: "missing" } });
    expect(screen.getByText("未找到匹配的效果预设。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "未启用" }));
    expect(screen.getByRole("button", { name: "已启用" })).toBeInTheDocument();
  });

  it("localizes effect labels and leaves the dynamic effect name untouched", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSection({ ...baseClip, styleId: effect.id });

    expect(screen.getAllByText("Raw Effect Name").length).toBeGreaterThan(0);
    expect(screen.getByText("修改字体排印将与效果预设分离。")).toBeInTheDocument();
    expect(screen.getByText("更改颜色将与效果预设分离。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索效果...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    expect(confirm).toHaveBeenCalledWith("切换到模板模式将丢弃文字样式设置。是否继续？");
  });

  it("localizes template controls, preserves stable IDs, and generates Chinese defaults", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const handleUpdateMultiple = vi.fn();
    const { unmount } = renderSection(
      {
        ...baseClip,
        text: "",
        templateId: "raw-template-id",
        customization: { primaryText: "", secondaryText: "", accentText: "", layerTexts: {} },
      },
      { handleUpdateMultiple },
    );

    expect(screen.getByText("当前模板：Raw Template Label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分离模板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模板库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下三分之一字幕" })).toBeInTheDocument();
    expect(screen.getByText("Second Raw Template")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "字幕" }));
    expect(screen.getByText("Caption Raw Template")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索模板...")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索模板..."), { target: { value: "missing" } });
    expect(screen.getByText("未找到匹配的模板。")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索模板..."), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Caption Raw Template" }));
    expect(handleUpdateMultiple).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "caption-template-id",
        text: "标题",
        customization: expect.objectContaining({ primaryText: "标题", secondaryText: "副标题", accentText: "强调" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "纯文本" }));
    expect(confirm).toHaveBeenCalledWith("切换到其他模式将丢弃模板布局的自定义设置。是否继续？");
    expect(handleUpdateMultiple).toHaveBeenLastCalledWith(expect.objectContaining({ text: "文本" }));

    unmount();
    renderSection({ ...baseClip, templateId: "missing-template-id" });
    expect(screen.getByText("当前未启用模板。")).toBeInTheDocument();
    expect(screen.getByText("从下方模板库选择模板即可应用。")).toBeInTheDocument();
  });
});
