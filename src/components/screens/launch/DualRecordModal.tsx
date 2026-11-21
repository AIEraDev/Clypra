import React from "react";
import { Video } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface DualRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  isRecording: boolean;
  seconds: number;
  previewError: string | null;
  cameraNotice: string | null;
  onDismissCameraNotice: () => void;
  recordOptions: {
    audio: boolean;
    webcam: boolean;
    screen: boolean;
    screenType: "any" | "entire" | "window";
    resolution: "720p" | "1080p" | "4k";
    frameRate: 30 | 60;
  };
  setRecordOptions: React.Dispatch<
    React.SetStateAction<{
      audio: boolean;
      webcam: boolean;
      screen: boolean;
      screenType: "any" | "entire" | "window";
      resolution: "720p" | "1080p" | "4k";
      frameRate: 30 | 60;
    }>
  >;
  audioDevices: { deviceId: string; label: string }[];
  selectedAudioDeviceId: string;
  setSelectedAudioDeviceId: (id: string) => void;
  previewVideoRef: React.RefObject<HTMLVideoElement | null>;
  micLevelRef: React.RefObject<HTMLDivElement | null>;
  onStartCapture: () => void;
}

const formatTime = (secs: number) => {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

export const DualRecordModal: React.FC<DualRecordModalProps> = ({
  isOpen,
  onClose,
  isRecording,
  seconds,
  previewError,
  cameraNotice,
  onDismissCameraNotice,
  recordOptions,
  setRecordOptions,
  audioDevices,
  selectedAudioDeviceId,
  setSelectedAudioDeviceId,
  previewVideoRef,
  micLevelRef,
  onStartCapture,
}) => {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg max-h-[88vh] rounded-2xl p-5 shadow-2xl flex flex-col gap-3.5 bg-surface-floating border border-border-default text-text-primary overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <h3 className="text-sm font-bold flex items-center gap-2 text-text-primary">
            <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-danger/10 border border-danger/30 text-danger">
              <Video className="w-3.5 h-3.5" />
            </span>
            {t("launch.recordingScreenCamera")}
          </h3>
          <button
            onClick={onClose}
            disabled={isRecording}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Live Preview Stage */}
        <div className="relative h-36 rounded-xl bg-surface-app border border-border-default overflow-hidden shrink-0">
          {/* Screen preview placeholder */}
          {recordOptions.screen && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-app text-text-muted gap-2">
              <span className="text-3xl">🖥️</span>
              <span className="text-xs font-semibold text-text-secondary">
                Screen Capture Enabled
              </span>
              <span className="text-[10px] text-text-muted">
                System picker will prompt when capture begins
              </span>
            </div>
          )}

          {/* Webcam preview stream */}
          {recordOptions.webcam && (
            <div
              className={
                recordOptions.screen
                  ? "absolute bottom-2.5 right-2.5 w-32 aspect-video rounded-lg overflow-hidden border border-border-default shadow-lg bg-black"
                  : "w-full h-full"
              }
            >
              <video
                ref={previewVideoRef as any}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            </div>
          )}

          {/* Audio only placeholder */}
          {!recordOptions.screen && !recordOptions.webcam && (
            <div className="w-full h-full flex flex-col items-center justify-center text-text-muted gap-2">
              <span className="text-3xl">🎙️</span>
              <span className="text-xs font-medium text-text-secondary">
                Recording Audio Only
              </span>
            </div>
          )}

          {/* Camera notice banner */}
          {cameraNotice && (
            <div className="absolute top-2 left-2 right-2 z-20 bg-warning/20 border border-warning/40 text-text-primary text-[11px] px-3 py-1.5 rounded-lg flex items-center justify-between backdrop-blur-sm">
              <span>📷 {cameraNotice}</span>
              <button
                onClick={onDismissCameraNotice}
                className="text-text-secondary hover:text-text-primary cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Error banner */}
          {previewError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 bg-surface-app/95">
              <span className="text-2xl">⚠️</span>
              <p className="text-xs text-danger leading-relaxed max-w-xs">
                {previewError}
              </p>
            </div>
          )}

          {/* REC active badge */}
          {isRecording && (
            <div className="absolute top-2.5 left-2.5 bg-danger text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 shadow-md">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              REC {formatTime(seconds)}
            </div>
          )}
        </div>

        {/* Source Option Toggles */}
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              { key: "screen" as const, label: "Screen", icon: "🖥️" },
              { key: "webcam" as const, label: "Camera", icon: "📷" },
              { key: "audio" as const, label: "Microphone", icon: "🎙️" },
            ] as const
          ).map(({ key, label, icon }) => (
            <label
              key={key}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border select-none transition-all ${
                recordOptions[key]
                  ? "bg-accent/10 border-accent text-accent font-semibold"
                  : "bg-surface-elevated border-border-default text-text-muted opacity-60"
              } ${
                isRecording
                  ? "opacity-40 cursor-not-allowed pointer-events-none"
                  : "cursor-pointer hover:bg-surface-hover"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={recordOptions[key]}
                onChange={(e) =>
                  setRecordOptions({
                    ...recordOptions,
                    [key]: e.target.checked,
                  })
                }
                disabled={isRecording}
              />
              <span className="text-lg">{icon}</span>
              <span className="text-[11px]">{label}</span>
            </label>
          ))}
        </div>

        {/* Screen Source Preference */}
        {recordOptions.screen && !isRecording && (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-surface-elevated border border-border-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Screen Capture Source
            </span>
            <select
              value={recordOptions.screenType}
              onChange={(e) =>
                setRecordOptions({
                  ...recordOptions,
                  screenType: e.target.value as any,
                })
              }
              className="w-full bg-surface-input border border-border-default rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="any">Standard System Picker (Let me choose)</option>
              <option value="entire">Prefer Entire Display</option>
              <option value="window">Prefer Application Window</option>
            </select>
          </div>
        )}

        {/* Quality Controls: Resolution & FPS */}
        {!isRecording && (
          <div className="grid grid-cols-2 gap-2.5 p-2.5 rounded-xl bg-surface-elevated border border-border-subtle">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Resolution
              </span>
              <div className="grid grid-cols-3 gap-1 bg-surface-app p-0.5 rounded-lg border border-border-subtle">
                {(["720p", "1080p", "4k"] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() =>
                      setRecordOptions({ ...recordOptions, resolution: res })
                    }
                    className={`py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      recordOptions.resolution === res
                        ? "bg-accent text-white shadow-2xs"
                        : "text-text-muted hover:text-text-primary hover:bg-surface-elevated"
                    }`}
                  >
                    {res.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Frame Rate
              </span>
              <div className="grid grid-cols-2 gap-1 bg-surface-app p-0.5 rounded-lg border border-border-subtle">
                {([30, 60] as const).map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() =>
                      setRecordOptions({ ...recordOptions, frameRate: fps })
                    }
                    className={`py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      recordOptions.frameRate === fps
                        ? "bg-accent text-white shadow-2xs"
                        : "text-text-muted hover:text-text-primary hover:bg-surface-elevated"
                    }`}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Microphone Source & Meter */}
        {recordOptions.audio && !isRecording && (
          <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-surface-elevated border border-border-subtle">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <span>Microphone Source</span>
              {audioDevices.length > 0 && (
                <span className="text-emerald-500 font-bold flex items-center gap-1">
                  ● Live Meter
                </span>
              )}
            </div>

            {audioDevices.length > 0 ? (
              <div className="flex flex-col gap-2">
                <select
                  value={selectedAudioDeviceId}
                  onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
                  className="w-full bg-surface-input border border-border-default rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent cursor-pointer"
                >
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>

                {/* Level Bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted">Level:</span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-app overflow-hidden flex items-center border border-border-subtle">
                    <div
                      ref={micLevelRef as any}
                      className="h-full rounded-full transition-all duration-75"
                      style={{
                        width: "0%",
                        background:
                          "linear-gradient(90deg, var(--clypra-status-success) 0%, var(--clypra-status-warning) 75%, var(--clypra-status-error) 100%)",
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-muted">
                No microphone devices detected.
              </p>
            )}
          </div>
        )}

        {/* CTA Button */}
        <div className="pt-1">
          <button
            onClick={onStartCapture}
            disabled={
              !recordOptions.screen &&
              !recordOptions.webcam &&
              !recordOptions.audio
            }
            className="w-full py-2.5 rounded-xl bg-danger hover:bg-danger/90 active:bg-danger text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-danger/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="w-2 h-2 rounded-full bg-white" />
            {t("launch.startCapture")}
          </button>
        </div>
      </div>
    </div>
  );
};
