import React from "react";
import { NativeProgramPreview } from "./NativeProgramPreview.jsx";
import { WebGLUnavailableError } from "./WebGLUnavailableError.jsx";

// React Error Boundary for the native preview surface. Browser compatibility
// support remains isolated behind the migration boundary.
class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[PreviewLifecycle] Program preview error boundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      const isGpuFailure = this.state.error?.message.toLowerCase().includes("gpu") ?? false;
      return <WebGLUnavailableError reason={isGpuFailure ? "gpu" : "native-surface"} />;
    }
    return this.props.children;
  }
}

export const ProgramPreview: React.FC<any> = (props) => {
  return (
    <PreviewErrorBoundary>
      <NativeProgramPreview {...props} />
    </PreviewErrorBoundary>
  );
};
