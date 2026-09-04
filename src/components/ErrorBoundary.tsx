import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode | ((props: { error: Error | null; reset: () => void }) => React.ReactNode);
  name?: string;
  onReset?: () => void;
  compact?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary for catching render errors in subtrees.
 * Prevents full app crash when a child component throws during render.
 * Supports granular subsystem isolation and localized recovery.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const label = this.props.name ? `[ErrorBoundary: ${this.props.name}]` : "[ErrorBoundary]";
    console.error(`${label} Caught unhandled error:`, error, errorInfo);

    // Forward to crash telemetry pipeline. Import lazily to avoid circular
    // dependencies during module initialisation.
    import("@/core/telemetry").then(({ crashReporter }) => {
      void crashReporter.reportCrash({
        crashType: "SUBSYSTEM_ERROR",
        error,
        subsystem: this.props.name,
        componentStack: errorInfo.componentStack ?? undefined,
      });
    }).catch(() => {
      // Telemetry must never cascade into the error boundary itself.
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const { fallback, name, compact } = this.props;
      const { error } = this.state;

      if (typeof fallback === "function") {
        return fallback({ error, reset: this.handleReset });
      }

      if (fallback) {
        return fallback;
      }

      const subsystemName = name || "Subsystem";

      if (compact) {
        return (
          <div
            data-testid={`error-boundary-${name || "compact"}`}
            className="flex items-center justify-between p-2 rounded bg-danger/10 border border-danger/25 text-xs text-danger"
          >
            <div className="flex items-center gap-1.5 truncate">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-danger" />
              <span className="truncate">{name ? `${name} error` : "Error"}</span>
            </div>
            <button
              onClick={this.handleReset}
              className="p-1 rounded hover:bg-danger/20 transition-colors text-text-primary"
              title={`Reload ${subsystemName}`}
              aria-label={`Reload ${subsystemName}`}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        );
      }

      return (
        <div
          data-testid={`error-boundary-${name || "default"}`}
          className="flex flex-col items-center justify-center h-full w-full gap-3 p-6 text-center bg-surface-raised/40 border border-white/6 rounded-lg select-none"
        >
          <div className="w-10 h-10 rounded-full bg-danger/15 flex items-center justify-center text-danger border border-danger/30">
            <AlertTriangle className="w-5 h-5" />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {name ? `${name} encountered an error` : "Something went wrong"}
            </h3>
            <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto font-mono line-clamp-2">
              {error?.message || "An unexpected error occurred in this panel."}
            </p>
          </div>

          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white/10 hover:bg-white/15 active:bg-white/20 text-text-primary border border-white/10 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reload {subsystemName}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

