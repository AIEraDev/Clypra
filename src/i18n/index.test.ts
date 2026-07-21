import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveMessage, t } from "./index";
import type { MessageParams } from "./types";

describe("i18n", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("uses Simplified Chinese by default", () => {
    expect(t("common.save")).toBe("保存");
  });

  test("interpolates message parameters", () => {
    expect(t("common.selectedCount", { count: 3 })).toBe("已选择 3 项");
  });

  test("falls back to English when the Simplified Chinese message is empty", () => {
    expect(resolveMessage({ en: "Open", zhCN: "" }, "test.open")).toBe("Open");
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
