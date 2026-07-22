import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TextTemplate } from "@/features/text-templates/types";
import { TemplateLayerEditor } from "../TemplateLayerEditor";

const animation = {
  in: "none",
  out: "none",
  inDuration: 0,
  outDuration: 0,
  hold: "full",
} as const;

const template = {
  id: "raw-template-id",
  label: "Raw Template",
  category: "lower-third",
  duration: 4,
  canvasWidth: 1920,
  canvasHeight: 1080,
  thumbnail: "",
  preview: "",
  layers: [
    {
      kind: "text",
      id: "hero-text-layer",
      content: "用户原文",
      role: "primary",
      fontFamily: "Arial",
      fontSize: 37,
      fontWeight: 500,
      color: "#12ab34",
      align: "center",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      animation,
    },
    {
      kind: "shape",
      id: "raw-fill-layer",
      shape: "rect",
      fill: "#abcdef",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      animation,
    },
    {
      kind: "image",
      id: "logo-image-layer",
      url: "https://example.com/raw-logo.png",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      animation,
    },
    {
      kind: "image",
      id: "fallback-image-layer",
      url: "",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      animation,
    },
  ],
} satisfies TextTemplate;

describe("TemplateLayerEditor localization", () => {
  it("localizes static UI while preserving layer-derived labels, roles, and values", () => {
    render(<TemplateLayerEditor template={template} customization={{}} onChange={vi.fn()} />);

    expect(screen.getByText("模板图层")).toBeInTheDocument();
    expect(screen.getByText("hero text")).toBeInTheDocument();
    expect(screen.getByText("primary")).toBeInTheDocument();

    fireEvent.click(screen.getByText("hero text"));
    expect(screen.getByRole("textbox", { name: "文本内容" })).toHaveValue("用户原文");
    expect(screen.getByText("#12ab34")).toBeInTheDocument();
    expect(screen.getByLabelText("文字颜色")).toHaveValue("#12ab34");
    expect(screen.getByText("字号")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "字重" })).toHaveValue("500");
    expect(screen.getByRole("option", { name: "粗体 (700)" })).toHaveValue("700");

    fireEvent.click(screen.getByText("raw"));
    expect(screen.getByText("填充颜色")).toBeInTheDocument();
    expect(screen.getByText("#abcdef")).toBeInTheDocument();
    expect(screen.getByLabelText("填充颜色")).toHaveValue("#abcdef");

    fireEvent.click(screen.getByText("logo image"));
    expect(screen.getByText("URL: https://example.com/raw-logo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByText("fallback image"));
    expect(screen.getByText("URL: 默认")).toBeInTheDocument();
  });

  it("keeps onChange keys and values unchanged", () => {
    const onChange = vi.fn();
    render(<TemplateLayerEditor template={template} customization={{}} onChange={onChange} />);

    fireEvent.click(screen.getByText("hero text"));
    fireEvent.change(screen.getByRole("textbox", { name: "文本内容" }), { target: { value: "新的用户文本" } });
    expect(onChange).toHaveBeenLastCalledWith({
      primaryText: "新的用户文本",
      layerTexts: { "hero-text-layer": "新的用户文本" },
    });

    fireEvent.change(screen.getByLabelText("文字颜色"), { target: { value: "#654321" } });
    expect(onChange).toHaveBeenLastCalledWith({
      primaryColor: "#654321",
      layerColors: { "hero-text-layer": "#654321" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "字重" }), { target: { value: "700" } });
    expect(onChange).toHaveBeenLastCalledWith({ layerFontWeights: { "hero-text-layer": 700 } });

    fireEvent.change(screen.getByRole("slider"), { target: { value: "64" } });
    expect(onChange).toHaveBeenLastCalledWith({ layerFontSizes: { "hero-text-layer": 64 } });
  });
});
