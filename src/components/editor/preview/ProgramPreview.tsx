import React from "react";
import { NativeProgramPreview } from "./NativeProgramPreview.jsx";
import { WebGLUnavailableError } from "./WebGLUnavailableError.jsx";

// React Error Boundary for the native preview surface. Browser compatibility
// support remains isolated behind the migration boundary.
class PreviewErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[PreviewLifecycle] Program preview error boundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export const ProgramPreview: React.FC<any> = (props) => {
  return (
    <PreviewErrorBoundary fallback={<WebGLUnavailableError />}>
      <NativeProgramPreview {...props} />
    </PreviewErrorBoundary>
  );
};
