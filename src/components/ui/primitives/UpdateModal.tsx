import React, { useEffect, useRef, useState } from "react";
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
 * Full-screen bottom-sheet modal for Clypra release announcements.
 * Covers the entire app viewport and slides in from the bottom in 1 second.
 * Provides an immersive, premium experience when a new version is available.
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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Cleanup close timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleClose = () => {
    if (isExiting) return;
    setIsExiting(true);
    closeTimerRef.current = setTimeout(() => {
      setVisible(false);
      setIsExiting(false);
      if (status === "downloaded") {
        later();
      } else {
        dismiss();
      }
    }, 700);
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
      title: t("update.modal.features.performance"),
      desc: t("update.modal.features.performanceDesc"),
    },
    {
      icon: Layers,
      title: t("update.modal.features.newFeatures"),
      desc: t("update.modal.features.newFeaturesDesc"),
    },
    {
      icon: Settings,
      title: t("update.modal.features.bugFixes"),
      desc: t("update.modal.features.bugFixesDesc"),
    },
  ];

  const slideState = isExiting ? "exiting" : "entering";

  return (
    <>
      {/* Full-screen backdrop — subtle darkening behind the sheet */}
      <div
        aria-hidden="true"
        data-slide={slideState}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          animation: isExiting
            ? "um-backdrop-out 0.65s cubic-bezier(0.4, 0, 1, 1) forwards"
            : "um-backdrop-in 0.6s ease forwards",
          cursor: "pointer",
        }}
        onClick={handleClose}
      />

      {/* Full-screen bottom sheet — slides up from bottom */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        aria-describedby="update-modal-description"
        data-slide={slideState}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10001,
          display: "flex",
          flexDirection: "column",
          animation: isExiting
            ? "um-sheet-out 0.7s cubic-bezier(0.4, 0, 0.6, 1) forwards"
            : "um-sheet-in 1s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          pointerEvents: "auto",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative background — full viewport gradient */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(160deg, var(--clypra-surface-app) 0%, var(--clypra-surface-panel) 50%, var(--clypra-surface-floating) 100%)",
            zIndex: 0,
          }}
        />

        {/* Atmospheric glow orbs */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              width: "60vw",
              height: "60vw",
              top: "-20vw",
              left: "-10vw",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--clypra-interaction-focus) 10%, transparent) 0%, transparent 70%)",
              animation: "um-orb-drift 8s ease-in-out infinite alternate",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "50vw",
              height: "50vw",
              bottom: "-10vw",
              right: "-5vw",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--clypra-clip-effect-bg) 8%, transparent) 0%, transparent 70%)",
              animation: "um-orb-drift 10s ease-in-out infinite alternate-reverse",
            }}
          />
        </div>

        {/* Close button — top right */}
        <div
          style={{
            position: "absolute",
            top: "24px",
            right: "24px",
            zIndex: 2,
          }}
        >
          <button
            onClick={handleClose}
            title={t("Close")}
            aria-label={t("Close")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              border:
                "1px solid color-mix(in srgb, var(--clypra-text-primary) 12%, transparent)",
              background:
                "color-mix(in srgb, var(--clypra-surface-panel) 80%, transparent)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: "var(--clypra-text-secondary)",
              cursor: "pointer",
              transition: "all 0.15s ease",
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--clypra-text-primary) 10%, transparent)";
              e.currentTarget.style.color = "var(--clypra-text-primary)";
              e.currentTarget.style.borderColor =
                "color-mix(in srgb, var(--clypra-text-primary) 20%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--clypra-surface-panel) 80%, transparent)";
              e.currentTarget.style.color = "var(--clypra-text-secondary)";
              e.currentTarget.style.borderColor =
                "color-mix(in srgb, var(--clypra-text-primary) 12%, transparent)";
            }}
          >
            <X style={{ width: "18px", height: "18px" }} />
          </button>
        </div>

        {/* Main layout — centered content */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 24px 40px",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "680px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0px",
            }}
          >
            {/* Badge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "7px 18px",
                borderRadius: "24px",
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--clypra-interaction-focus) 18%, transparent), color-mix(in srgb, var(--clypra-clip-effect-bg) 14%, transparent))",
                border:
                  "1px solid color-mix(in srgb, var(--clypra-interaction-focus) 30%, transparent)",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.3px",
                color: "var(--clypra-text-primary)",
                marginBottom: "28px",
                animation: "um-fade-up 0.5s ease 0.3s both",
              }}
            >
              <Sparkles
                style={{
                  width: "13px",
                  height: "13px",
                  color: "var(--clypra-interaction-focus)",
                }}
              />
              {t("update.modal.newRelease")}
            </div>

            {/* Hero icon */}
            <div
              style={{
                position: "relative",
                marginBottom: "32px",
                animation: "um-fade-up 0.5s ease 0.2s both",
              }}
            >
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: "-28px",
                  background:
                    "radial-gradient(circle, color-mix(in srgb, var(--clypra-interaction-focus) 22%, transparent) 0%, transparent 70%)",
                  animation: "um-pulse 2.5s ease-in-out infinite",
                }}
              />
              <div
                style={{
                  position: "relative",
                  width: "88px",
                  height: "88px",
                  borderRadius: "24px",
                  background:
                    "linear-gradient(135deg, color-mix(in srgb, var(--clypra-interaction-focus) 22%, transparent), color-mix(in srgb, var(--clypra-clip-effect-bg) 22%, transparent))",
                  border:
                    "2px solid color-mix(in srgb, var(--clypra-interaction-focus) 35%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow:
                    "0 12px 40px color-mix(in srgb, var(--clypra-interaction-focus) 30%, transparent), 0 4px 16px rgba(0,0,0,0.3)",
                }}
              >
                {isDownloading || isApplying ? (
                  <Download
                    style={{
                      width: "40px",
                      height: "40px",
                      color: "var(--clypra-interaction-focus)",
                      animation: isDownloading
                        ? "um-bounce 1.2s ease-in-out infinite"
                        : undefined,
                    }}
                  />
                ) : (
                  <Sparkles
                    style={{
                      width: "40px",
                      height: "40px",
                      color: "var(--clypra-interaction-focus)",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Version title */}
            <h1
              id="update-modal-title"
              style={{
                margin: "0 0 16px 0",
                fontSize: "clamp(32px, 5vw, 52px)",
                fontWeight: 800,
                color: "var(--clypra-text-primary)",
                lineHeight: 1.1,
                textAlign: "center",
                letterSpacing: "-1px",
                animation: "um-fade-up 0.55s ease 0.25s both",
              }}
            >
              {isDownloading
                ? t("update.modal.downloadingUpdate")
                : isDownloaded
                  ? `Clypra ${updateInfo?.version} ${t("update.modal.isReady")}`
                  : isApplying
                    ? t("update.modal.preparingUpdate")
                    : `Clypra ${updateInfo?.version}`}
            </h1>

            {/* Subtitle */}
            <p
              id="update-modal-description"
              style={{
                margin: "0 0 48px 0",
                fontSize: "clamp(15px, 2vw, 18px)",
                color: "var(--clypra-text-secondary)",
                lineHeight: 1.6,
                textAlign: "center",
                maxWidth: "480px",
                animation: "um-fade-up 0.55s ease 0.35s both",
              }}
            >
              {isDownloading
                ? t("update.modal.keepWorking")
                : isDownloaded
                  ? t("update.modal.projectSaved")
                  : isApplying
                    ? t("update.modal.savingProject")
                    : t("update.modal.releasedOnGitHub")}
            </p>

            {/* Download progress */}
            {isDownloading && (
              <div
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  marginBottom: "48px",
                  animation: "um-fade-up 0.4s ease both",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "10px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--clypra-text-secondary)",
                    }}
                  >
                    {t("update.modal.downloading")}
                  </span>
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 800,
                      color: "var(--clypra-interaction-focus)",
                    }}
                  >
                    {downloadProgress}%
                  </span>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    borderRadius: "4px",
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
                      transition: "width 0.4s ease",
                      borderRadius: "4px",
                      boxShadow:
                        "0 0 12px color-mix(in srgb, var(--clypra-interaction-focus) 50%, transparent)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div
                style={{
                  width: "100%",
                  maxWidth: "480px",
                  marginBottom: "32px",
                  padding: "14px 18px",
                  borderRadius: "12px",
                  background:
                    "color-mix(in srgb, var(--clypra-status-error) 10%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--clypra-status-error) 25%, transparent)",
                  fontSize: "13px",
                  color: "var(--clypra-status-error)",
                  lineHeight: 1.5,
                  animation: "um-fade-up 0.4s ease both",
                }}
              >
                {error}
              </div>
            )}

            {/* Downloaded success banner */}
            {isDownloaded && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  width: "100%",
                  maxWidth: "480px",
                  padding: "18px 20px",
                  borderRadius: "16px",
                  background:
                    "color-mix(in srgb, var(--clypra-status-success) 10%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--clypra-status-success) 25%, transparent)",
                  marginBottom: "40px",
                  animation: "um-fade-up 0.4s ease 0.4s both",
                }}
              >
                <CheckCircle2
                  style={{
                    width: "22px",
                    height: "22px",
                    color: "var(--clypra-status-success)",
                    flexShrink: 0,
                  }}
                />
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    color: "var(--clypra-text-primary)",
                    lineHeight: 1.4,
                  }}
                >
                  {t("update.modal.downloadSuccess")}
                </p>
              </div>
            )}

            {/* What's New feature cards */}
            {!isDownloading && !isApplying && !isDownloaded && (
              <div
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "14px",
                  marginBottom: "56px",
                }}
              >
                {releaseFeatures.map((feature, idx) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        padding: "20px",
                        borderRadius: "16px",
                        background:
                          "color-mix(in srgb, var(--clypra-text-primary) 4%, transparent)",
                        border:
                          "1px solid color-mix(in srgb, var(--clypra-text-primary) 7%, transparent)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        animation: `um-fade-up 0.5s ease ${0.4 + idx * 0.08}s both`,
                      }}
                    >
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "12px",
                          background:
                            "linear-gradient(135deg, color-mix(in srgb, var(--clypra-interaction-focus) 15%, transparent), color-mix(in srgb, var(--clypra-clip-effect-bg) 15%, transparent))",
                          border:
                            "1px solid color-mix(in srgb, var(--clypra-interaction-focus) 20%, transparent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon
                          style={{
                            width: "20px",
                            height: "20px",
                            color: "var(--clypra-interaction-focus)",
                          }}
                        />
                      </div>
                      <div>
                        <p
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "14px",
                            fontWeight: 700,
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
                            lineHeight: 1.5,
                          }}
                        >
                          {feature.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* CTA buttons */}
            {!isDownloading && !isApplying && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  width: "100%",
                  maxWidth: "400px",
                  animation: "um-fade-up 0.5s ease 0.55s both",
                }}
              >
                {/* Primary */}
                {canDownload && !isDownloaded && (
                  <button
                    onClick={downloadUpdate}
                    title={t("update.modal.downloadWithoutInterrupting")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px",
                      padding: "17px 28px",
                      borderRadius: "16px",
                      fontSize: "16px",
                      fontWeight: 700,
                      cursor: "pointer",
                      border: "none",
                      background:
                        "linear-gradient(135deg, var(--clypra-interaction-focus) 0%, var(--clypra-clip-effect-bg) 100%)",
                      color: "var(--clypra-surface-app)",
                      boxShadow:
                        "0 6px 24px color-mix(in srgb, var(--clypra-interaction-focus) 40%, transparent), 0 2px 8px rgba(0,0,0,0.2)",
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                      width: "100%",
                      letterSpacing: "0.1px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px) scale(1.01)";
                      e.currentTarget.style.boxShadow =
                        "0 10px 32px color-mix(in srgb, var(--clypra-interaction-focus) 50%, transparent), 0 4px 12px rgba(0,0,0,0.25)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "";
                      e.currentTarget.style.boxShadow =
                        "0 6px 24px color-mix(in srgb, var(--clypra-interaction-focus) 40%, transparent), 0 2px 8px rgba(0,0,0,0.2)";
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = "translateY(0) scale(0.99)";
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px) scale(1.01)";
                    }}
                  >
                    <Download style={{ width: "18px", height: "18px" }} />
                    {t("update.modal.downloadUpdate")}
                    <ArrowRight style={{ width: "16px", height: "16px" }} />
                  </button>
                )}

                {isDownloaded && (
                  <button
                    onClick={applyUpdate}
                    title={t("update.modal.saveAndRestart")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px",
                      padding: "17px 28px",
                      borderRadius: "16px",
                      fontSize: "16px",
                      fontWeight: 700,
                      cursor: "pointer",
                      border: "none",
                      background:
                        "linear-gradient(135deg, var(--clypra-interaction-focus) 0%, var(--clypra-clip-effect-bg) 100%)",
                      color: "var(--clypra-surface-app)",
                      boxShadow:
                        "0 6px 24px color-mix(in srgb, var(--clypra-interaction-focus) 40%, transparent), 0 2px 8px rgba(0,0,0,0.2)",
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                      width: "100%",
                      letterSpacing: "0.1px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px) scale(1.01)";
                      e.currentTarget.style.boxShadow =
                        "0 10px 32px color-mix(in srgb, var(--clypra-interaction-focus) 50%, transparent), 0 4px 12px rgba(0,0,0,0.25)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "";
                      e.currentTarget.style.boxShadow =
                        "0 6px 24px color-mix(in srgb, var(--clypra-interaction-focus) 40%, transparent), 0 2px 8px rgba(0,0,0,0.2)";
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = "translateY(0) scale(0.99)";
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px) scale(1.01)";
                    }}
                  >
                    {t("update.modal.restartAndUpdate")}
                    <ArrowRight style={{ width: "16px", height: "16px" }} />
                  </button>
                )}

                {/* Secondary */}
                <button
                  onClick={handleClose}
                  style={{
                    padding: "14px 28px",
                    borderRadius: "16px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    border:
                      "1px solid color-mix(in srgb, var(--clypra-text-primary) 14%, transparent)",
                    background:
                      "color-mix(in srgb, var(--clypra-text-primary) 5%, transparent)",
                    color: "var(--clypra-text-secondary)",
                    transition: "all 0.15s ease",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "color-mix(in srgb, var(--clypra-text-primary) 9%, transparent)";
                    e.currentTarget.style.color = "var(--clypra-text-primary)";
                    e.currentTarget.style.borderColor =
                      "color-mix(in srgb, var(--clypra-text-primary) 20%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      "color-mix(in srgb, var(--clypra-text-primary) 5%, transparent)";
                    e.currentTarget.style.color = "var(--clypra-text-secondary)";
                    e.currentTarget.style.borderColor =
                      "color-mix(in srgb, var(--clypra-text-primary) 14%, transparent)";
                  }}
                >
                  {isDownloaded ? t("update.modal.remindLater") : t("update.modal.later")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes um-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes um-backdrop-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }

        @keyframes um-sheet-in {
          from { transform: translateY(100%); }
          to   { transform: translateY(0%); }
        }
        @keyframes um-sheet-out {
          from { transform: translateY(0%); }
          to   { transform: translateY(100%); }
        }

        @keyframes um-fade-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes um-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.08); }
        }

        @keyframes um-bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-6px); }
        }

        @keyframes um-orb-drift {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(3vw, 2vw) scale(1.08); }
        }
      `}</style>
    </>
  );
};
