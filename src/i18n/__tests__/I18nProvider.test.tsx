import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { I18nProvider, useI18n } from "../I18nProvider";

function TestLanguageSwitcher() {
  const { language, setLanguage } = useI18n();

  return (
    <div>
      <span data-testid="title">Settings</span>
      <span data-testid="lang-display">{language}</span>
      <button onClick={() => setLanguage("zh-TW")}>Switch to Chinese</button>
      <button onClick={() => setLanguage("en")}>Switch to English</button>
    </div>
  );
}

describe("I18nProvider — Language Switching & Reverse Translation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("switches language to Traditional Chinese and back to English immediately", async () => {
    render(
      <I18nProvider>
        <TestLanguageSwitcher />
      </I18nProvider>
    );

    const titleEl = screen.getByTestId("title");
    const toZhBtn = screen.getByText("Switch to Chinese");
    const toEnBtn = screen.getByText("Switch to English");

    expect(titleEl.textContent).toBe("Settings");

    // Switch to Traditional Chinese
    act(() => {
      toZhBtn.click();
    });

    expect(titleEl.textContent).toBe("設定");
    expect(screen.getByTestId("lang-display").textContent).toBe("zh-TW");

    // Switch BACK to English
    act(() => {
      toEnBtn.click();
    });

    expect(titleEl.textContent).toBe("Settings");
    expect(screen.getByTestId("lang-display").textContent).toBe("en");
  });
});
