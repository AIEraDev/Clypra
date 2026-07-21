import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveMessage, t } from "./index";

describe("i18n", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
