import React, { useEffect, useState } from "react";
import { Download, X, Sparkles, ArrowRight } from "lucide-react";
import type { UseAutoUpdaterReturn } from "@/hooks/useAutoUpdater";

interface UpdateBannerProps {
  updater: UseAutoUpdaterReturn;
}

/**
 * A floating, animated banner that appears from the bottom of the screen when
 * a new Clypra release is available on GitHub. Non-blocking — the user can
 * dismiss or install without interrupting their workflow.
 */
export const UpdateBanner: React.FC<UpdateBannerProps> = ({ updater }) => {
  const { status, updateInfo, downloadProgress, error, deferred, dismiss, later, downloadUpdate, applyUpdate } =
    updater;

  const [visible, setVisible] = useState(false);

  // Animate in when an update is available
  useEffect(() => {
    if ((status === "available" || status === "downloaded") && !deferred) {
      // Small delay for a smoother entrance
      const t = setTimeout(() => setVisible(true), 200);
      return () => clearTimeout(t);
    } else if (status === "dismissed" || deferred) {
      setVisible(false);
    }
  }, [status, deferred]);

  const isDownloading = status === "downloading";
  const isDownloaded = status === "downloaded";
  const isApplying = status === "applying";
  const canDownload = status === "available" || (status === "error" && !!updateInfo);

  // Don't render anything unless relevant
  if (
    status === "idle" ||
    status === "checking" ||
    status === "up-to-date" ||
    status === "dismissed" ||
    (status === "error" && !updateInfo) ||
    (isDownloaded && deferred)
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="update-banner-root"
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: `translateX(-50%) translateY(${visible ? "0" : "120%"})`,
        zIndex: 9999,
        transition: "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 16px",
          borderRadius: "20px",
          border: "1px solid rgba(255,255,255,0.12)",
          background:
            "linear-gradient(135deg, rgba(24,24,36,0.96) 0%, rgba(18,18,28,0.98) 100%)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow:
            "0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
          minWidth: "320px",
          maxWidth: "480px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow accent */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 0% 50%, rgba(96,165,250,0.07) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Download progress bar (behind content) */}
        {isDownloading && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              height: "2px",
              width: `${downloadProgress}%`,
              background:
                "linear-gradient(90deg, var(--color-accent, #60a5fa), #a78bfa)",
              transition: "width 0.3s ease",
              borderRadius: "0 2px 0 0",
            }}
          />
        )}

        {/* Icon */}
        <div
          style={{
            flexShrink: 0,
            width: "36px",
            height: "36px",
            borderRadius: "12px",
            background:
              "linear-gradient(135deg, rgba(96,165,250,0.15) 0%, rgba(167,139,250,0.15) 100%)",
            border: "1px solid rgba(96,165,250,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {isDownloading || isApplying ? (
            <Download
              style={{ width: "16px", height: "16px", color: "#60a5fa" }}
            />
          ) : (
            <Sparkles
              style={{ width: "16px", height: "16px", color: "#60a5fa" }}
            />
          )}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text-primary, #f1f5f9)",
              lineHeight: 1.3,
            }}
          >
            {isDownloading
              ? `Downloading update… ${downloadProgress}%`
              : isDownloaded
                ? `Clypra ${updateInfo?.version} is ready to apply`
                : isApplying
                  ? "Preparing Clypra for restart…"
              : `Clypra ${updateInfo?.version} is available`}
          </p>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: "11px",
              color: "var(--color-text-muted, #94a3b8)",
              lineHeight: 1.3,
            }}
          >
            {isDownloading
              ? "You can keep working while it downloads"
              : isDownloaded
                ? "Your project will be saved before the update is applied"
                : isApplying
                  ? "Saving your project and closing the active session"
                  : "A new version has been released on GitHub"}
          </p>
          {/* Error fallback */}
          {error && (
            <p
              style={{
                margin: "3px 0 0",
                fontSize: "10px",
                color: "#f87171",
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        {!isDownloading && !isApplying && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            {canDownload && (
            <button
              id="update-banner-download-btn"
              onClick={downloadUpdate}
              title="Download update without interrupting your session"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "6px 14px",
                borderRadius: "12px",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                border: "none",
                background:
                  "linear-gradient(135deg, var(--color-accent, #60a5fa) 0%, #a78bfa 100%)",
                color: "#fff",
                boxShadow: "0 2px 12px rgba(96,165,250,0.3)",
                transition: "filter 0.15s ease, transform 0.1s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.filter =
                  "brightness(1.1)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.filter = "")
              }
              onMouseDown={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(0.97)")
              }
              onMouseUp={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.transform = "")
              }
            >
              {isDownloaded ? "Restart and update" : "Download update"}
              <ArrowRight style={{ width: "12px", height: "12px" }} />
            </button>
            )}

            {isDownloaded && (
              <button
                id="update-banner-apply-btn"
                onClick={applyUpdate}
                title="Save the project and restart with the update"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "6px 14px",
                  borderRadius: "12px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background: "linear-gradient(135deg, var(--color-accent, #60a5fa) 0%, #a78bfa 100%)",
                  color: "#fff",
                  whiteSpace: "nowrap",
                }}
              >
                Restart and update
                <ArrowRight style={{ width: "12px", height: "12px" }} />
              </button>
            )}

            {isDownloaded && (
              <button
                id="update-banner-later-btn"
                onClick={later}
                title="Keep working and apply the update later"
                style={{
                  padding: "6px 10px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--color-text-muted, #94a3b8)",
                }}
              >
                Later
              </button>
            )}

            <button
              id="update-banner-dismiss-btn"
              onClick={isDownloaded ? later : dismiss}
              title="Dismiss update notification"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "10px",
                fontSize: "11px",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--color-text-muted, #94a3b8)",
                transition: "background 0.15s ease, color 0.15s ease",
                padding: 0,
              }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = "rgba(255,255,255,0.08)";
                btn.style.color = "var(--color-text-primary, #f1f5f9)";
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = "rgba(255,255,255,0.04)";
                btn.style.color = "var(--color-text-muted, #94a3b8)";
              }}
            >
              <X style={{ width: "13px", height: "13px" }} />
            </button>
          </div>
        )}

        {/* Spinner when downloading and no progress bar yet */}
        {isDownloading && downloadProgress === 0 && (
          <div
            aria-hidden
            style={{
              flexShrink: 0,
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              border: "2px solid rgba(96,165,250,0.2)",
              borderTopColor: "#60a5fa",
              animation: "spin 0.8s linear infinite",
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
