import React from "react";
import { CheckCircle2 } from "lucide-react";

interface SuccessCheckProps {
  size?: number;
}

export const SuccessCheck: React.FC<SuccessCheckProps> = ({ size = 160 }) => {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Pulse ring */}
      <div className="absolute inset-0 rounded-full animate-ping opacity-10" style={{ background: "var(--color-accent)" }} />
      <div
        className="absolute inset-2 rounded-full opacity-8"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--color-accent) 15%, transparent) 0%, transparent 70%)`,
        }}
      />

      {/* Check circle */}
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))",
        }}
      >
        <CheckCircle2 className="w-10 h-10 text-white" />
      </div>
    </div>
  );
};
