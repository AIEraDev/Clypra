import React from "react";
import { t } from "@/i18n";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary for catching render errors in subtrees.
 * Prevents full app crash when a child component throws during render.
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
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
          <div className="text-lg font-semibold text-red-400">{t("app.somethingWentWrong")}</div>
          <div className="text-sm text-text-muted max-w-md">
            {this.state.error?.message || t("app.unexpectedError")}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 px-4 py-2 text-sm rounded bg-white/10 hover:bg-white/15 text-text-primary transition-colors"
          >
            {t("common.retry")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
