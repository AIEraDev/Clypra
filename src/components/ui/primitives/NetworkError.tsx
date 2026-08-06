import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface NetworkErrorProps {
  message?: string;
  onRetry: () => void;
}

export const NetworkError: React.FC<NetworkErrorProps> = ({ message = "No internet connection", onRetry }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {/* Warning Icon */}
      <div className="mb-4 rounded-full border-2 border-text-muted/20 p-4">
        <AlertCircle className="h-12 w-12 text-text-muted" />
      </div>

      {/* Error Message */}
      <p className="text-base text-text-muted mb-6">{message}</p>

      {/* Reload Button */}
      <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg transition-colors font-medium text-sm">
        <RefreshCw className="h-4 w-4" />
        Reload
      </button>
    </div>
  );
};
