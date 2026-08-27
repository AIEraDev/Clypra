import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

// Throwing component for testing error boundaries
function Bomb({ shouldThrow, message }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message || "Simulated component crash");
  }
  return <div data-testid="bomb-safe">Subsystem Operational</div>;
}

describe("ErrorBoundary Subsystem Isolation & Recovery", () => {
  // Suppress console.error in tests for expected thrown errors
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary name="Timeline">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("bomb-safe")).toHaveTextContent("Subsystem Operational");
    expect(screen.queryByTestId("error-boundary-Timeline")).toBeNull();
  });

  it("catches render errors and renders subsystem name and error message", () => {
    render(
      <ErrorBoundary name="Timeline">
        <Bomb shouldThrow={true} message="Timeline track clip index overflow" />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("error-boundary-Timeline")).toBeInTheDocument();
    expect(screen.getByText("Timeline encountered an error")).toBeInTheDocument();
    expect(screen.getByText("Timeline track clip index overflow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload Timeline/i })).toBeInTheDocument();
  });

  it("allows recovery via Reload button and invokes onReset callback", () => {
    const onResetMock = vi.fn();

    function ParentWrapper() {
      const [hasError, setHasError] = useState(true);
      return (
        <ErrorBoundary
          name="Preview Monitor"
          onReset={() => {
            onResetMock();
            setHasError(false);
          }}
        >
          <Bomb shouldThrow={hasError} message="WebGL context failure" />
        </ErrorBoundary>
      );
    }

    render(<ParentWrapper />);

    expect(screen.getByText("Preview Monitor encountered an error")).toBeInTheDocument();
    const reloadBtn = screen.getByRole("button", { name: /Reload Preview Monitor/i });

    fireEvent.click(reloadBtn);

    expect(onResetMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bomb-safe")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary-Preview Monitor")).toBeNull();
  });

  it("renders compact mode for slim panels", () => {
    render(
      <ErrorBoundary name="Media Library" compact>
        <Bomb shouldThrow={true} message="Disk quota exceeded" />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("error-boundary-Media Library")).toBeInTheDocument();
    expect(screen.getByText("Media Library error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload Media Library" })).toBeInTheDocument();
  });

  it("supports custom fallback render function with error and reset handler", () => {
    render(
      <ErrorBoundary
        name="Properties"
        fallback={({ error, reset }) => (
          <div data-testid="custom-fallback">
            <span>Custom: {error?.message}</span>
            <button onClick={reset}>Custom Reset</button>
          </div>
        )}
      >
        <Bomb shouldThrow={true} message="Invalid keyframe bezier" />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.getByText("Custom: Invalid keyframe bezier")).toBeInTheDocument();
  });

  it("isolates failure so sibling subsystems remain intact", () => {
    render(
      <div data-testid="workspace">
        <ErrorBoundary name="Media Library">
          <div data-testid="media-panel">Media Library Active</div>
        </ErrorBoundary>

        <ErrorBoundary name="Timeline">
          <Bomb shouldThrow={true} message="Corrupt timeline cache" />
        </ErrorBoundary>

        <ErrorBoundary name="Properties Inspector">
          <div data-testid="properties-panel">Properties Active</div>
        </ErrorBoundary>
      </div>
    );

    // Timeline failed and caught in its own boundary
    expect(screen.getByText("Timeline encountered an error")).toBeInTheDocument();

    // Sibling panels media and properties are unharmed
    expect(screen.getByTestId("media-panel")).toBeInTheDocument();
    expect(screen.getByTestId("media-panel")).toHaveTextContent("Media Library Active");
    expect(screen.getByTestId("properties-panel")).toBeInTheDocument();
    expect(screen.getByTestId("properties-panel")).toHaveTextContent("Properties Active");
  });
});
