import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast, notify, resolveToastMessage } from "../toast";
import i18nInstance from "@/i18n/i18nInstance";

vi.mock("sonner", () => {
  const mockSonner = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast: mockSonner };
});

describe("toast notification localization", () => {
  beforeEach(async () => {
    await i18nInstance.changeLanguage("en");
    vi.clearAllMocks();
  });

  it("resolves canonical semantic keys in English", () => {
    const resolved = resolveToastMessage("errors.unexpected");
    expect(resolved).toBe("Something went wrong. The application encountered an unexpected error.");
  });

  it("resolves canonical semantic keys in Russian when active language changes", async () => {
    await i18nInstance.changeLanguage("ru");
    const resolved = resolveToastMessage("errors.applicationError");
    expect(resolved).toBe("Ошибка приложения");
  });

  it("resolves interpolation variables in toast messages", async () => {
    await i18nInstance.changeLanguage("en");
    const resolved = resolveToastMessage("common.items.clipsCount", {
      interpolation: { count: 5 },
    });
    expect(resolved).toBe("5 clips");
  });

  it("passes unkeyed raw strings through unmodified", () => {
    const raw = "Disk write failure on custom device /dev/sda1";
    expect(resolveToastMessage(raw)).toBe(raw);
  });

  it("translates message when calling notify() with variant", async () => {
    await i18nInstance.changeLanguage("en");
    notify("timeline.tools.gapsClosed", "info");

    const { toast: sonner } = await import("sonner");
    expect(sonner.info).toHaveBeenCalledWith("Closed timeline gaps", undefined);
  });

  it("translates message when calling toast.error() with semantic key", async () => {
    await i18nInstance.changeLanguage("ru");
    toast.error("export.failed");

    const { toast: sonner } = await import("sonner");
    expect(sonner.error).toHaveBeenCalledWith("Сбой экспорта", undefined);
  });
});
