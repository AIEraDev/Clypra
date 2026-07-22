import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { setLanguage } from "@/i18n";
import type { RecoverySnapshot } from "@/core/runtime/CrashRecoveryService";
import { CrashRecoveryDialog } from "./CrashRecoveryDialog";

describe("CrashRecoveryDialog", () => {
  afterEach(() => setLanguage("zhCN"));

  test("formats the saved time in the selected interface language", () => {
    const snapshot = {
      savedAt: new Date(2026, 6, 8, 12, 5).toISOString(),
      project: {
        id: "project-1",
        name: "客户项目",
        createdAt: 1,
        updatedAt: 1,
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 0,
        mediaAssets: [],
      },
      mediaAssets: [],
      tracks: [],
      clips: [],
      transitions: [],
    } satisfies RecoverySnapshot;
    const props = {
      isOpen: true,
      snapshot,
      isRestoring: false,
      onRestore: vi.fn(),
      onDiscard: vi.fn(),
    };

    render(<CrashRecoveryDialog {...props} />);
    expect(screen.getByText(/2026年7月8日/)).toBeInTheDocument();

    act(() => setLanguage("en"));
    expect(screen.getByText(/Jul 8, 2026/)).toBeInTheDocument();
  });
});
