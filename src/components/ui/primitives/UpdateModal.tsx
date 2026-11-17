import React, { useEffect, useState } from "react";
import {
  Download,
  X,
  Sparkles,
  ArrowRight,
  Zap,
  Layers,
  Settings,
  CheckCircle2,
} from "lucide-react";
import type { UseAutoUpdaterReturn } from "@/hooks/useAutoUpdater";
import { useI18n } from "@/i18n";

interface UpdateModalProps {
  updater: UseAutoUpdaterReturn;
}

/**
 * Full-screen slide-in modal for Clypra release announcements.
 * Provides an immersive, professional experience when a new version is available.
 * Slides in from the right edge with backdrop blur overlay.
 */
export const UpdateModal: React.FC<UpdateModalProps> = ({ updater }) => {
  const { t } = useI18n();
  const {
    status,
    updateInfo,
    downloadProgress,
    error,
    deferred,
    dismiss,
    later,
    downloadUpdate,
    applyUpdate,
  } = updater;

  const [visible, setVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // Animate in when an update is available
  useEffect(() => {
    if ((status === "available" || status === "downloaded") && !deferred) {
      const timer = setTimeout(() => setVisible(true), 300);
      return () => clearTimeout(timer);
    } else if (status === "dismissed" || deferred) {
      handleClose();
    }
  }, [status, deferred]);

  // ESC key handler
  useEffect(() => {
    if (!visible) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [visible]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setVisible(false);
      setIsExiting(false);
      if (status === "downloaded") {
        later();
      } else {
        dismiss();
      }
    }, 350);
  };

  const isDownloading = status === "downloading";
  const isDownloaded = status === "downloaded";
  const isApplying = status === "applying";
  const canDownload =
    status === "available" || (status === "error" && !!updateInfo);

  // Don't render unless relevant
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

  if (!visible && !isExiting) return null;

  const releaseFeatures = [
    {
      icon: Zap,
      title: t("Performance Improvements"),
      desc: t("Faster rendering and preview"),
    },
    {
      icon: Layers,
      title: t("New Features"),
      desc: t("Enhanced editing capabilities"),
    },
    {
      icon: Settings,
      title: t("Bug Fixes"),
      desc: t("Stability and reliability improvements"),
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`update-modal-backdrop ${isExiting ? "exiting" : ""}`}
        onClick={handleClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          background:
            "color-mix(in srgb, var(--clypra-surface-app) 70%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          animation: isExiting
            ? "fadeOut 0.3s ease forwards"
            : "fadeIn 0.3s ease forwards",
          cursor: "pointer",
        }}
      />

      {/* Modal Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        aria-describedby="update-modal-description"
        className={`update-modal-panel ${isExiting ? "exiting" : ""}`}
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: "min(480px, 90vw)",
          zIndex: 10001,
          background:
            "linear-gradient(165deg, var(--clypra-surface-floating) 0%, var(--clypra-surface-panel) 100%)",
          boxShadow:
            "-4px 0 32px rgba(0, 0, 0, 0.4), -2px 0 16px rgba(0, 0, 0, 0.2)",
          animation: isExiting
            ? "slideOut 0.35s cubic-bezier(0.32, 0, 0.67, 0) forwards"
            : "slideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "24px 24px 20px",
            borderBottom:
              "1px solid color-mix(in srgb, var(--clypra-text-primary) 8%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px",
              borderRadius: "20px",
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--clypra-interaction-focus) 15%, transparent), color-mix(in srgb, var(--clypra-clip-effect-bg) 15%, transparent))",
              border:
                "1px solid color-mix(in srgb, var(--clypra-interaction-focus) 25%, transparent)",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--clypra-text-primary)",
            }}
          >
            <Sparkles
              style={{
                width: "14px",
                height: "14px",
                color: "var(--clypra-interaction-focus)",
              }}
            />
            {t("New Release Available")}
          </div>

          <button
            onClick={handleClose}
            title={t("Close")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              borderRadius: "10px",
              border:
                "1px solid color-mix(in srgb, var(--clypra-text-primary) 10%, transparent)",
              background:
                "color-mix(in srgb, var(--clypra-text-primary) 5%, transparent)",
              color: "var(--clypra-text-secondary)",
              cursor: "pointer",
              transition: "all 0.15s ease",
              padding: 0,
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget;
              btn.style.background =
                "color-mix(in srgb, var(--clypra-text-primary) 10%, transparent)";
              btn.style.color = "var(--clypra-text-primary)";
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget;
              btn.style.background =
                "color-mix(in srgb, var(--clypra-text-primary) 5%, transparent)";
              btn.style.color = "var(--clypra-text-secondary)";
            }}
          >
            <X style={{ width: "16px", height: "16px" }} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "32px 24px 24px",
          }}
        >
          {/* Hero Section */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              marginBottom: "40px",
            }}
          >
            {/* Animated Icon */}
            <div
              style={{
                position: "relative",
                marginBottom: "24px",
              }}
            >
              {/* Glow effect */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: "-20px",
                  background:
                    "radial-gradient(circle, color-mix(in srgb, var(--clypra-interaction-focus) 20%, transparent) 0%, transparent 70%)",
                  animation: "pulse 2s ease-in-out infinite",
                }}
              />

              <div
                style={{
                  position: "relative",
                  width: "72px",
                  height: "72px",
                  borderRadius: "20px",
                  background:
                    "linear-gradient(135deg, color-mix(in srgb, var(--clypra-interaction-focus) 20%, transparent), color-mix(in srgb, var(--clypra-clip-effect-bg) 20%, transparent))",
                  border:
                    "2px solid color-mix(in srgb, var(--clypra-interaction-focus) 30%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow:
                    "0 8px 24px color-mix(in srgb, var(--clypra-interaction-focus) 25%, transparent)",
                }}
              >
                {isDownloading || isApplying ? (
                  <Download
                    style={{
                      width: "32px",
                      height: "32px",
                      color: "var(--clypra-interaction-focus)",
                      animation: isDownloading
                        ? "bounce 1s ease-in-out infinite"
                        : undefined,
                    }}
                  />
                ) : (
                  <Sparkles
                    style={{
                      width: "32px",
                      height: "32px",
                      color: "var(--clypra-interaction-focus)",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Version Title */}
            <h2
              id="update-modal-title"
              style={{
                margin: "0 0 12px 0",
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--clypra-text-primary)",
                lineHeight: 1.2,
              }}
            >
              {isDownloading
                ? t("Downloading Update...")
                : isDownloaded
                  ? `Clypra ${updateInfo?.version} ${t("is ready")}`
                  : isApplying
                    ? t("Preparing Update...")
                    : `Clypra ${updateInfo?.version}`}
            </h2>

            {/* Subtitle */}
            <p
              id="update-modal-description"
              style={{
                margin: 0,
                fontSize: "14px",
                color: "var(--clypra-text-secondary)",
                lineHeight: 1.5,
                maxWidth: "360px",
              }}
            >
              {isDownloading
                ? t("You can keep working while it downloads")
                : isDownloaded
                  ? t("Your project will be saved before the update is applied")
                  : isApplying
                    ? t("Saving your project and closing the active session")
                    : t("A new version has been released on GitHub")}
            </p>

            {/* Download Progress */}
            {isDownloading && (
              <div
                style={{
                  marginTop: "20px",
                  width: "100%",
                  maxWidth: "300px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--clypra-text-secondary)",
                    }}
                  >
                    {t("Downloading")}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "var(--clypra-interaction-focus)",
                    }}
                  >
                    {downloadProgress}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div
                  style={{
                    width: "100%",
                    height: "6px",
                    borderRadius: "3px",
                    background:
                      "color-mix(in srgb, var(--clypra-text-primary) 10%, transparent)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${downloadProgress}%`,
                      background:
                        "linear-gradient(90deg, var(--clypra-interaction-focus), var(--clypra-clip-effect-bg))",
                      transition: "width 0.3s ease",
                      borderRadius: "3px",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <p
                style={{
                  marginTop: "16px",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background:
                    "color-mix(in srgb, var(--clypra-status-error) 10%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--clypra-status-error) 20%, transparent)",
                  fontSize: "12px",
                  color: "var(--clypra-status-error)",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                {error}
              </p>
            )}
          </div>

          {/* Features Section */}
          {!isDownloading && !isApplying && status !== "downloaded" && (
            <div style={{ marginBottom: "24px" }}>
              <h3
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--clypra-text-primary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {t("What's New")}
              </h3>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {releaseFeatures.map((feature, idx) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        gap: "12px",
                        padding: "14px",
                        borderRadius: "12px",
                        background:
                          "color-mix(in srgb, var(--clypra-text-primary) 4%, transparent)",
                        border:
                          "1px solid color-mix(in srgb, var(--clypra-text-primary) 6%, transparent)",
                        animation: `fadeInUp 0.4s ease forwards ${idx * 0.1}s`,
                        opacity: 0,
                      }}
                    >
                      <div
                        style={{
                          flexShrink: 0,
                          width: "36px",
                          height: "36px",
                          borderRadius: "10px",
                          background:
                            "linear-gradient(135deg, color-mix(in srgb, var(--clypra-interaction-focus) 12%, transparent), color-mix(in srgb, var(--clypra-clip-effect-bg) 12%, transparent))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon
                          style={{
                            width: "18px",
                            height: "18px",
                            color: "var(--clypra-interaction-focus)",
                          }}
                        />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            margin: "0 0 2px 0",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "var(--clypra-text-primary)",
                            lineHeight: 1.3,
                          }}
                        >
                          {feature.title}
                        </p>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--clypra-text-secondary)",
                            lineHeight: 1.4,
                          }}
                        >
                          {feature.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Downloaded State Message */}
          {isDownloaded && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px",
                borderRadius: "12px",
                background:
                  "color-mix(in srgb, var(--clypra-status-success) 10%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--clypra-status-success) 20%, transparent)",
                marginBottom: "24px",
              }}
            >
              <CheckCircle2
                style={{
                  width: "20px",
                  height: "20px",
                  color: "var(--clypra-status-success)",
                  flexShrink: 0,
                }}
              />
              <p
                style={{
                  margin: 0,
                  fontSize: "13px",
                  color: "var(--clypra-text-primary)",
                  lineHeight: 1.4,
                }}
              >
                {t(
                  "Update downloaded successfully. Restart to apply the new version.",
                )}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {!isDownloading && !isApplying && (
          <div
            style={{
              padding: "20px 24px",
              borderTop:
                "1px solid color-mix(in srgb, var(--clypra-text-primary) 8%, transparent)",
              background: "var(--clypra-surface-panel)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              flexShrink: 0,
            }}
          >
            {/* Primary Action */}
            {canDownload && !isDownloaded && (
              <button
                onClick={downloadUpdate}
                title={t("Download update without interrupting your session")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px 20px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background:
                    "linear-gradient(135deg, var(--clypra-interaction-focus) 0%, var(--clypra-clip-effect-bg) 100%)",
                  color: "var(--clypra-surface-app)",
                  boxShadow:
                    "0 4px 16px color-mix(in srgb, var(--clypra-interaction-focus) 35%, transparent)",
                  transition: "all 0.2s ease",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow =
                    "0 6px 20px color-mix(in srgb, var(--clypra-interaction-focus) 45%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow =
                    "0 4px 16px color-mix(in srgb, var(--clypra-interaction-focus) 35%, transparent)";
                }}
              >
                <Download style={{ width: "16px", height: "16px" }} />
                {t("Download Update")}
                <ArrowRight style={{ width: "14px", height: "14px" }} />
              </button>
            )}

            {isDownloaded && (
              <button
                onClick={applyUpdate}
                title={t("Save the project and restart with the update")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px 20px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "none",
                  background:
                    "linear-gradient(135deg, var(--clypra-interaction-focus) 0%, var(--clypra-clip-effect-bg) 100%)",
                  color: "var(--clypra-surface-app)",
                  boxShadow:
                    "0 4px 16px color-mix(in srgb, var(--clypra-interaction-focus) 35%, transparent)",
                  transition: "all 0.2s ease",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow =
                    "0 6px 20px color-mix(in srgb, var(--clypra-interaction-focus) 45%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow =
                    "0 4px 16px color-mix(in srgb, var(--clypra-interaction-focus) 35%, transparent)";
                }}
              >
                {t("Restart and update")}
                <ArrowRight style={{ width: "14px", height: "14px" }} />
              </button>
            )}

            {/* Secondary Action */}
            <button
              onClick={handleClose}
              style={{
                padding: "12px 20px",
                borderRadius: "12px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                border:
                  "1px solid color-mix(in srgb, var(--clypra-text-primary) 12%, transparent)",
                background:
                  "color-mix(in srgb, var(--clypra-text-primary) 5%, transparent)",
                color: "var(--clypra-text-secondary)",
                transition: "all 0.15s ease",
                width: "100%",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "color-mix(in srgb, var(--clypra-text-primary) 8%, transparent)";
                e.currentTarget.style.color = "var(--clypra-text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  "color-mix(in srgb, var(--clypra-text-primary) 5%, transparent)";
                e.currentTarget.style.color = "var(--clypra-text-secondary)";
              }}
            >
              {isDownloaded ? t("Remind Me Later") : t("Later")}
            </button>
          </div>
        )}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }

        @keyframes slideOut {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.8; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Custom Scrollbar */
        .update-modal-panel > div:nth-child(2)::-webkit-scrollbar {
          width: 6px;
        }

        .update-modal-panel > div:nth-child(2)::-webkit-scrollbar-track {
          background: transparent;
        }

        .update-modal-panel > div:nth-child(2)::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--clypra-text-primary) 20%, transparent);
          border-radius: 3px;
        }

        .update-modal-panel > div:nth-child(2)::-webkit-scrollbar-thumb:hover {
          background: color-mix(in srgb, var(--clypra-text-primary) 30%, transparent);
        }
      `}</style>
    </>
  );
};
