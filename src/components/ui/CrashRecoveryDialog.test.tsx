import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { setLanguage } from "@/i18n";
import type { RecoverySnapshot } from "@/core/runtime/CrashRecoveryService";
import { CrashRecoveryDialog } from "./CrashRecoveryDialog";

describe("CrashRecoveryDialog", () => {
  afterEach(() => setLanguage("zhCN"));

  test("formats the saved time in the selected interface language", () => {
    const snapshot = {
      savedAt: new Date(2026, 6, 8, 12, 5).toISOString(),
      project: { name: "客户项目" },
    } as RecoverySnapshot;
    const props = {
      isOpen: true,
      snapshot,
      isRestoring: false,
      onRestore: vi.fn(),
      onDiscard: vi.fn(),
    };

    const view = render(<CrashRecoveryDialog {...props} />);
    expect(screen.getByText(/2026年7月8日/)).toBeInTheDocument();

    view.unmount();
    setLanguage("en");
    render(<CrashRecoveryDialog {...props} />);
    expect(screen.getByText(/Jul 8, 2026/)).toBeInTheDocument();
  });
});
