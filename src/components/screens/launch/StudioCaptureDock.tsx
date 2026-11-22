import React from "react";
import { Video, Camera, Smartphone } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface StudioCaptureDockProps {
  onOpenDualRecord: () => void;
  onOpenCameraBooth: () => void;
  onOpenPhoneTransfer: () => void;
  isDesktop: boolean;
}

export const StudioCaptureDock: React.FC<StudioCaptureDockProps> = ({
  onOpenDualRecord,
  onOpenCameraBooth,
  onOpenPhoneTransfer,
  isDesktop,
}) => {
  const { t } = useI18n();

  if (!isDesktop) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          {t("launch.captureTitle")}
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Dual Screen & Camera Recording */}
        <button
          onClick={onOpenDualRecord}
          className="group flex items-center gap-3 p-3.5 rounded-xl bg-surface-panel border border-border-default hover:border-danger/40 hover:bg-surface-hover transition-all duration-200 cursor-pointer text-left shadow-2xs"
        >
          <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/25 flex items-center justify-center text-danger group-hover:scale-105 transition-transform shrink-0">
            <Video className="w-5 h-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-text-primary group-hover:text-danger transition-colors truncate">
              {t("launch.recordScreenCamera")}
            </span>
            <span className="text-[11px] text-text-muted truncate mt-0.5">
              Screen + FaceCam PiP sync
            </span>
          </div>
        </button>

        {/* Camera Booth */}
        <button
          onClick={onOpenCameraBooth}
          className="group flex items-center gap-3 p-3.5 rounded-xl bg-surface-panel border border-border-default hover:border-accent/40 hover:bg-surface-hover transition-all duration-200 cursor-pointer text-left shadow-2xs"
        >
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/25 flex items-center justify-center text-accent group-hover:scale-105 transition-transform shrink-0">
            <Camera className="w-5 h-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-text-primary group-hover:text-accent transition-colors truncate">
              {t("launch.cameraBooth")}
            </span>
            <span className="text-[11px] text-text-muted truncate mt-0.5">
              High-res webcam video take
            </span>
          </div>
        </button>

        {/* Phone Transfer */}
        <button
          onClick={onOpenPhoneTransfer}
          className="group flex items-center gap-3 p-3.5 rounded-xl bg-surface-panel border border-border-default hover:border-emerald-500/40 hover:bg-surface-hover transition-all duration-200 cursor-pointer text-left shadow-2xs"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-500 group-hover:scale-105 transition-transform shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-text-primary group-hover:text-emerald-500 transition-colors truncate">
              {t("launch.phoneTransfer")}
            </span>
            <span className="text-[11px] text-text-muted truncate mt-0.5">
              Beam media over Wi-Fi
            </span>
          </div>
        </button>
      </div>
    </section>
  );
};
