import React, { useState, useEffect } from "react";
import { Check, RefreshCw } from "lucide-react";
import { isTauriDesktop } from "@/services/updaterService";
import { useAutoUpdater } from "@/hooks/useAutoUpdater";
import { useI18n } from "@/i18n/I18nProvider";
import { getAppVersion, getAppVersionSync } from "@/lib/app/appVersion";

// ─── Brand Icons ─────────────────────────────────────────────────────────
const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const XIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const PatreonIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M14.82 2.41C11.47 2.41 8.75 5.13 8.75 8.49c0 3.35 2.72 6.07 6.07 6.07 3.35 0 6.07-2.72 6.07-6.07 0-3.36-2.72-6.08-6.07-6.08zM3.11 21.59h3.3V2.41H3.11z" />
  </svg>
);

const BuyMeCoffeeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
    <path d="M18 8h-1V6h-2v2H5C3.346 8 2 9.346 2 11v2c0 1.654 1.346 3 3 3h.268A3.001 3.001 0 008 18h8a3.001 3.001 0 002.732-2H19c1.654 0 3-1.346 3-3v-2c0-1.654-1.346-3-3-3zm1 5c0 .551-.448 1-1 1h-.535A3.01 3.01 0 0018 13v-3h1c.552 0 1 .449 1 1v2z" />
    <path d="M8 5c0-.552.449-1 1-1s1 .448 1 1v1c0 .552-.449 1-1 1S8 6.552 8 6V5zm4 0c0-.552.449-1 1-1s1 .448 1 1v1c0 .552-.449 1-1 1s-1-.448-1-1V5z" />
  </svg>
);

const openExternalUrl = async (url: string) => {
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.error("Tauri openUrl failed, falling back to window.open", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

export const AboutTab: React.FC = () => {
  const [appVersion, setAppVersion] = useState<string>(() => getAppVersionSync());
  const { t } = useI18n();
  const {
    status: updateStatus,
    updateInfo,
    downloadProgress,
    error: updateError,
    downloadUpdate,
    applyUpdate,
    later,
    recheckUpdate,
  } = useAutoUpdater();

  const isDesktop = isTauriDesktop();

  useEffect(() => {
    let isMounted = true;
    getAppVersion()
      .then((ver) => {
        if (isMounted && ver) {
          setAppVersion(ver);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const handleCheckUpdate = async () => {
    await recheckUpdate();
  };

  const displayVersion = appVersion
    ? appVersion.startsWith("v")
      ? appVersion
      : `v${appVersion}`
    : "";

  return (
    <div className="flex flex-col items-center text-center py-4 gap-5 max-w-xl mx-auto">
      {/* Brand & Identity */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 flex items-center justify-center relative">
          <div className="absolute inset-0 bg-accent-primary/20 blur-xl rounded-full" />
          <img
            src="/clypra.svg"
            alt="Clypra Logo"
            className="w-16 h-16 object-contain relative z-10 drop-shadow-md"
          />
        </div>
        <div>
          <div className="flex items-center justify-center gap-2">
            <h3 className="text-xl font-bold text-text-primary tracking-tight">Clypra</h3>
            {displayVersion && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-surface-elevated text-text-muted border border-border-subtle">
                {displayVersion}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted max-w-xs mt-2 leading-relaxed">
            {t("settings.about.description")}
          </p>
        </div>
      </div>

      {/* Auto-updater Card */}
      <div className="w-full bg-surface-card border border-border-default/80 rounded-2xl p-5 flex flex-col items-center gap-4 shadow-xs">
        <div className="flex items-center gap-2 w-full justify-between pb-3 border-b border-border-subtle">
          <span className="text-xs font-semibold text-text-primary tracking-wide uppercase">
            {t("settings.about.softwareUpdate")}
          </span>
          {updateStatus === "up-to-date" ? (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : updateStatus === "available" || updateStatus === "downloaded" ? (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
            </span>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-2 w-full">
          {!isDesktop ? (
            <p className="text-xs text-text-muted">
              Auto-updates are only available in the desktop app.
            </p>
          ) : (
            <>
              {updateStatus === "idle" && (
                <>
                  <p className="text-xs text-text-muted mb-1">
                    Keep Clypra running at peak performance.
                  </p>
                  <button
                    onClick={handleCheckUpdate}
                    className="flex items-center gap-1.5 px-4 py-2 bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary rounded-xl text-xs font-semibold cursor-pointer shadow-xs transition-all active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Check for Updates
                  </button>
                </>
              )}

              {updateStatus === "checking" && (
                <div className="flex flex-col items-center gap-2.5 py-2">
                  <div className="w-7 h-7 border-2 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
                  <p className="text-xs text-text-muted">
                    Searching for newer releases...
                  </p>
                </div>
              )}

              {updateStatus === "up-to-date" && (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Check className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                    Clypra is up to date
                  </p>
                  <p className="text-[11px] text-text-muted">
                    You are currently running the latest version.
                  </p>
                  <button
                    onClick={handleCheckUpdate}
                    className="mt-1 text-xs text-text-muted hover:text-text-primary transition-colors underline cursor-pointer"
                  >
                    Check again
                  </button>
                </div>
              )}

              {updateStatus === "available" && updateInfo && (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="flex flex-col items-center gap-0.5">
                    <p className="text-xs text-text-primary font-bold">
                      New Version Available
                    </p>
                    <p className="text-xs text-accent-primary font-semibold">
                      v{updateInfo.version}
                    </p>
                  </div>

                  {updateInfo.body && (
                    <div className="w-full text-left">
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                        Release Notes
                      </p>
                      <div className="text-xs text-text-muted max-h-24 overflow-y-auto px-3 py-2 w-full leading-normal border border-border-default bg-surface-elevated rounded-xl scrollbar-thin">
                        {updateInfo.body}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => void downloadUpdate()}
                    className="w-full py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded-xl text-xs font-semibold cursor-pointer shadow-sm transition-all active:scale-[0.98]"
                  >
                    Download update
                  </button>
                  <p className="text-[10px] text-text-muted">
                    You can keep editing while the update downloads.
                  </p>
                </div>
              )}

              {updateStatus === "downloading" && (
                <div className="flex flex-col items-center gap-3 w-full py-1">
                  <div className="flex justify-between text-xs text-text-primary font-medium w-full">
                    <span>Downloading update...</span>
                    <span className="font-semibold text-accent-primary">
                      {downloadProgress}%
                    </span>
                  </div>
                  <div className="w-full bg-surface-elevated border border-border-default h-2 rounded-full overflow-hidden p-0.5">
                    <div
                      className="bg-accent-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-text-muted">
                    The app will not restart until you choose to apply the update.
                  </p>
                </div>
              )}

              {updateStatus === "downloaded" && updateInfo && (
                <div className="flex flex-col items-center gap-3 w-full py-1">
                  <p className="text-xs text-text-primary font-semibold">
                    Update downloaded
                  </p>
                  <p className="text-[11px] text-text-muted text-center">
                    Clypra will save your project and restart when you choose to apply.
                  </p>
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => void applyUpdate()}
                      className="flex-1 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded-xl text-xs font-semibold cursor-pointer transition-all active:scale-[0.98]"
                    >
                      Restart and update
                    </button>
                    <button
                      onClick={later}
                      className="px-4 py-2.5 bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-muted rounded-xl text-xs font-semibold cursor-pointer transition-all"
                    >
                      Later
                    </button>
                  </div>
                </div>
              )}

              {updateStatus === "applying" && (
                <div className="flex flex-col items-center gap-2.5 py-2">
                  <div className="w-7 h-7 border-2 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
                  <p className="text-xs text-text-muted">
                    Saving project and preparing restart...
                  </p>
                </div>
              )}

              {updateStatus === "error" && (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="w-8 h-8 rounded-full bg-danger/10 border border-danger/20 flex items-center justify-center">
                    <span className="text-danger text-sm font-bold">!</span>
                  </div>
                  <p className="text-xs text-danger font-medium">
                    Update needs attention
                  </p>
                  <p className="text-[11px] text-text-muted max-w-xs leading-normal line-clamp-2">
                    {updateError || "An unknown error occurred."}
                  </p>
                  <button
                    onClick={() =>
                      void (updateInfo ? downloadUpdate() : handleCheckUpdate())
                    }
                    className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary rounded-xl text-xs font-semibold cursor-pointer transition-all active:scale-95"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {updateInfo ? "Retry download" : "Try Again"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Support the Project Card */}
      <div className="w-full bg-surface-card border border-border-default/80 rounded-2xl p-5 flex flex-col items-center gap-4 shadow-xs">
        <div className="flex items-center gap-2 w-full justify-between pb-3 border-b border-border-subtle">
          <span className="text-xs font-semibold text-text-primary tracking-wide uppercase">
            {t("settings.about.supportTitle")}
          </span>
          <span className="text-[11px] text-text-muted">
            Free &amp; open-source ♥
          </span>
        </div>
        <p className="text-xs text-text-muted text-center leading-relaxed">
          {t("settings.about.supportDesc")}
        </p>
        <div className="flex flex-col gap-2.5 w-full">
          {/* GitHub Sponsors */}
          <button
            onClick={() => openExternalUrl("https://github.com/sponsors/AIEraDev")}
            className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl text-white text-xs font-semibold cursor-pointer transition-all active:scale-[0.98] shadow-sm bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600"
          >
            <GithubIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">GitHub Sponsors</span>
            <span className="text-white/70 text-[10px] font-normal">Tiered</span>
          </button>
          {/* Patreon */}
          <button
            onClick={() => openExternalUrl("https://www.patreon.com/AIEraDev")}
            className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl text-white text-xs font-semibold cursor-pointer transition-all active:scale-[0.98] shadow-sm bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600"
          >
            <PatreonIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Support on Patreon</span>
            <span className="text-white/70 text-[10px] font-normal">Monthly</span>
          </button>
          {/* Buy Me a Coffee */}
          <button
            onClick={() => openExternalUrl("https://buymeacoffee.com/AIEraDev")}
            className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl text-slate-900 text-xs font-semibold cursor-pointer transition-all active:scale-[0.98] shadow-sm bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400"
          >
            <BuyMeCoffeeIcon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Buy Me a Coffee</span>
            <span className="text-slate-800/70 text-[10px] font-normal">One-time</span>
          </button>
        </div>
      </div>

      {/* Sticker & Open Media Attributions */}
      <div className="w-full bg-surface-elevated/50 border border-border-default/60 rounded-xl p-3.5 flex flex-col gap-1.5 text-left">
        <div className="flex items-center justify-between text-xs font-semibold text-text-primary">
          <span>{t("settings.about.credits")}</span>
          <span className="text-[10px] text-text-muted font-mono font-normal">
            CC BY 4.0 &bull; CC0
          </span>
        </div>
        <p className="text-[11px] text-text-muted leading-relaxed">
          Animated emojis by{" "}
          <span className="text-text-primary font-medium">Google Noto Emoji</span> under CC BY 4.0. Vector shapes by{" "}
          <span className="text-text-primary font-medium">Kenney</span> under CC0 1.0.
        </p>
      </div>

      {/* External Links */}
      <div className="flex items-center gap-5 mt-1">
        <button
          onClick={() => openExternalUrl("https://github.com/AIEraDev/clypra")}
          className="text-xs font-medium text-text-muted hover:text-accent-primary transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <GithubIcon className="w-3.5 h-3.5" />
          GitHub
        </button>
        <button
          onClick={() => openExternalUrl("https://x.com/AIEraDev")}
          className="text-xs font-medium text-text-muted hover:text-accent-primary transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <XIcon className="w-3.5 h-3.5" />
          @AIEraDev
        </button>
      </div>

      {/* Footer / Licenses */}
      <div className="flex items-center justify-between w-full text-[11px] text-text-muted pt-3 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          <span>Tauri 2.x</span>
          <span>&bull;</span>
          <span>React 19</span>
          <span>&bull;</span>
          <span>FFmpeg (GPL)</span>
        </div>
        <button
          onClick={() =>
            openExternalUrl(
              "https://github.com/AIEraDev/clypra/blob/main/THIRD_PARTY_LICENSES.md",
            )
          }
          className="hover:text-accent-primary underline transition-colors cursor-pointer"
        >
          {t("settings.about.thirdParty")}
        </button>
      </div>
    </div>
  );
};
