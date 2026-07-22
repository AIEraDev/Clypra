import { createElement, memo } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  getLanguage,
  resolveMessage,
  setLanguage,
  subscribeLanguage,
  t,
  useLanguage,
} from "./index";
import type { MessageParams } from "./types";

describe("i18n", () => {
  afterEach(() => {
    setLanguage("zhCN");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("uses Simplified Chinese by default", () => {
    expect(t("common.save")).toBe("保存");
  });

  test("interpolates message parameters", () => {
    expect(t("common.selectedCount", { count: 3 })).toBe("已选择 3 项");
  });

  test("uses the English catalog and interpolates parameters", () => {
    expect(
      resolveMessage(
        { en: "{{count}} selected", zhCN: "已选择 {{count}} 项" },
        "test.selectedCount",
        { count: 3 },
        "en",
      ),
    ).toBe("3 selected");
  });

  test("falls back to English when the Simplified Chinese message is empty", () => {
    expect(
      resolveMessage({ en: "Open", zhCN: "" }, "test.open", {}, "zhCN"),
    ).toBe("Open");
  });

  test("falls back to Simplified Chinese when the English message is empty", () => {
    expect(
      resolveMessage({ en: "", zhCN: "打开" }, "test.open", {}, "en"),
    ).toBe("打开");
  });

  test("switches the catalog language and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLanguage(listener);

    setLanguage("en");

    expect(getLanguage()).toBe("en");
    expect(t("common.save")).toBe("Save");
    expect(t("common.selectedCount", { count: 3 })).toBe("3 selected");
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    setLanguage("zhCN");
    expect(listener).toHaveBeenCalledOnce();
  });

  test("rerenders a memoized React subscriber immediately after switching", () => {
    let renderCount = 0;
    const LanguageLabel = memo(function LanguageLabel() {
      renderCount += 1;
      useLanguage();
      return createElement("span", null, t("common.save"));
    });

    render(createElement(LanguageLabel));
    expect(screen.getByText("保存")).toBeInTheDocument();

    act(() => setLanguage("en"));

    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(renderCount).toBe(2);
  });

  test("leaves missing parameters visible and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      resolveMessage(
        { en: "Open {{name}}", zhCN: "打开 {{name}}" },
        "test.open",
      ),
    ).toBe("打开 {{name}}");
    expect(warn).toHaveBeenCalledWith(
      '[i18n] Missing parameter "name" for "test.open"',
    );
  });

  test("treats an undefined runtime parameter as missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const params = { name: undefined } as unknown as MessageParams;

    expect(
      resolveMessage(
        { en: "Open {{name}}", zhCN: "打开 {{name}}" },
        "test.open",
        params,
      ),
    ).toBe("打开 {{name}}");
    expect(warn).toHaveBeenCalledWith(
      '[i18n] Missing parameter "name" for "test.open"',
    );
  });

  test("treats a null runtime parameter as missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const params = { name: null } as unknown as MessageParams;

    expect(
      resolveMessage(
        { en: "Open {{name}}", zhCN: "打开 {{name}}" },
        "test.open",
        params,
      ),
    ).toBe("打开 {{name}}");
    expect(warn).toHaveBeenCalledWith(
      '[i18n] Missing parameter "name" for "test.open"',
    );
  });

  test("interpolates valid falsy parameter values", () => {
    expect(
      resolveMessage(
        { en: "{{count}}:{{label}}", zhCN: "{{count}}:{{label}}" },
        "test.values",
        { count: 0, label: "" },
      ),
    ).toBe("0:");
  });

  test("does not warn about missing parameters in production", () => {
    vi.stubEnv("DEV", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      resolveMessage(
        { en: "Open {{name}}", zhCN: "打开 {{name}}" },
        "test.open",
      ),
    ).toBe("打开 {{name}}");
    expect(warn).not.toHaveBeenCalled();
  });
});
