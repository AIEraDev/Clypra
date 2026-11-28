import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackTab } from "../FeedbackTab";

vi.mock("@/lib/app/appVersion", () => ({
  getAppVersion: vi.fn().mockResolvedValue("1.6.9"),
  getAppVersionSync: vi.fn().mockReturnValue("1.6.9"),
  APP_VERSION: "1.6.9",
}));

vi.mock("@/services/perfLogService", () => ({
  perfLogService: {
    getSessionId: vi.fn().mockReturnValue("sess-test-123"),
  },
}));

describe("FeedbackTab", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("disables submit until description has at least 5 non-whitespace characters", () => {
    render(<FeedbackTab />);

    const submitButton = screen.getByRole("button", { name: /submit feedback/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    const textarea = screen.getByLabelText(/description/i);
    fireEvent.change(textarea, { target: { value: "  abc " } });
    expect(submitButton.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "Timeline audio drift after export" } });
    expect(submitButton.disabled).toBe(false);
  });

  it("submits feedback to /api/v1/feedback and renders confirmation with reference ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        ok: true,
        id: "fb-uuid-999",
        createdAt: "2026-11-28T10:30:00.000Z",
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackTab />);

    fireEvent.click(screen.getByLabelText(/feature request/i));
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Please add ripple delete across all unlocked tracks." },
    });
    fireEvent.change(screen.getByLabelText(/contact email/i), {
      target: { value: "creator@example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByText(/thank you for your feedback/i)).toBeDefined();
    });

    expect(screen.getByText(/fb-uuid-999/)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/feedback$/);
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.type).toBe("feature");
    expect(sentBody.description).toBe("Please add ripple delete across all unlocked tracks.");
    expect(sentBody.contactEmail).toBe("creator@example.com");
    expect(sentBody.appVersion).toBe("1.6.9");
    expect(sentBody.sessionId).toBe("sess-test-123");
    expect(sentBody.includeDiagnostics).toBe(true);
  });

  it("omits sessionId when includeDiagnostics is unchecked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        ok: true,
        id: "fb-uuid-1000",
        createdAt: "2026-11-28T10:31:00.000Z",
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackTab />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "General UI feedback without diagnostics." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByText(/thank you for your feedback/i)).toBeDefined();
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.includeDiagnostics).toBe(false);
    expect(sentBody.sessionId).toBeUndefined();
  });

  it("displays an error alert when the API returns an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: "Too many feedback submissions. Please try again later.",
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackTab />);

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Testing rate limit error handling." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Too many feedback submissions. Please try again later.",
      );
    });
  });
});
