import React, { useEffect, useState, useRef, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { isMacOSPlatform } from "@/lib/platform/windowPlatform";
import { useProjectStore } from "@/store/projectStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { AspectRatio, Project } from "@/types";
import type { FrameRate } from "@/store/settingsTypes";
import type { RecentProjectEntry } from "@/core/platform/platform";
import { generateRandomProjectName } from "@/lib/project/projectNameGenerator";
import { MAX_PROJECT_NAME_LENGTH } from "@/types";
import { useUIStore } from "@/store/uiStore";
import { platform } from "@/core/platform";
import { DualRecordService } from "@/services/dualRecordService";
import { useRecordingStore } from "@/store/recordingStore";
import { useCameraStore } from "@/store/cameraStore";
import { CameraRecordingModal } from "@/components/ui/CameraRecordingModal";
import { useI18n } from "@/i18n/I18nProvider";
import { safeJsonParse } from "@/core/security/inputSanitization";

import { LaunchHeader } from "./launch/LaunchHeader";
import { StudioActionHub } from "./launch/StudioActionHub";
import { StudioCaptureDock } from "./launch/StudioCaptureDock";
import { RecentProjectsWorkspace } from "./launch/RecentProjectsWorkspace";
import { ProjectTemplatesModal } from "./launch/ProjectTemplatesModal";
import { DualRecordModal } from "./launch/DualRecordModal";

interface LaunchScreenProps {
  onProjectCreate: (
    name: string,
    aspectRatio: AspectRatio,
    frameRate: FrameRate,
    initialClipPaths?: string[],
  ) => void;
  onProjectOpen: (project: RecentProjectEntry) => void;
}

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const countGraphemes = (str: string): number =>
  Array.from(graphemeSegmenter.segment(str)).length;

export const LaunchScreen: React.FC<LaunchScreenProps> = ({
  onProjectCreate,
  onProjectOpen,
}) => {
  const { t } = useI18n();
  const { recentProjects, setRecentProjects, deleteProject, renameProject } =
    useProjectStore();
  const { toggleSettingsModal } = useUIStore();
  const { openCameraModal } = useCameraStore();

  const isMacNativeWindow = isTauri && isMacOSPlatform();
  const isDesktop = !platform.isCapacitor();

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [projectToRename, setProjectToRename] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);

  // Dual recording state
  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [recordOptions, setRecordOptions] = useState({
    audio: true,
    webcam: true,
    screen: true,
    screenType: "any" as "any" | "entire" | "window",
    resolution: "1080p" as "720p" | "1080p" | "4k",
    frameRate: 30 as 30 | 60,
  });

  const {
    isRecording,
    setIsRecording,
    seconds,
    setSeconds,
    setHasWebcam,
    setRecordingError,
    reset: resetRecording,
  } = useRecordingStore();

  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [audioDevices, setAudioDevices] = useState<
    { deviceId: string; label: string }[]
  >([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] =
    useState<string>("");
  const micLevelRef = useRef<HTMLDivElement>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);

  // Refresh recent projects on mount
  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const projects = await platform.getRecentProjects();
        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      }
    };
    loadRecentProjects();
  }, [setRecentProjects]);

  // Clean up recording timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (!DualRecordService.getInstance().isRecording()) {
        DualRecordService.getInstance().cleanup();
      }
    };
  }, []);

  // Clean up timer when recording stops externally
  useEffect(() => {
    if (!isRecording && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRecording]);

  // Enumerate input devices when dual recording modal opens
  useEffect(() => {
    if (!isRecordOpen) return;

    const updateDevices = async () => {
      try {
        const audioDevs =
          await DualRecordService.getInstance().enumerateAudioDevices();
        setAudioDevices(audioDevs);

        if (audioDevs.length > 0) {
          setSelectedAudioDeviceId((prev) => {
            if (prev && audioDevs.some((d) => d.deviceId === prev)) return prev;
            return audioDevs[0].deviceId;
          });
        } else {
          setSelectedAudioDeviceId("");
        }
      } catch (err) {
        console.error("[LaunchScreen] Enumerate devices failed:", err);
      }
    };

    updateDevices();
    navigator.mediaDevices.addEventListener("devicechange", updateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", updateDevices);
    };
  }, [isRecordOpen]);

  // Camera, audio, and mic preview initialization
  useEffect(() => {
    if (!isRecordOpen || isRecording) return;

    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;

    DualRecordService.getInstance().stopPreview();
    DualRecordService.getInstance().stopScreenPreview();
    DualRecordService.getInstance().stopMicTest();
    setPreviewError(null);
    setCameraNotice(null);
    if (micLevelRef.current) {
      micLevelRef.current.style.width = "0%";
    }

    let animationFrameId: number;
    let active = true;

    const setupPreviews = async () => {
      try {
        const { stream, cameraError } =
          await DualRecordService.getInstance().startPreview(
            { webcam: recordOptions.webcam, audio: recordOptions.audio },
            selectedAudioDeviceId || undefined,
          );

        if (!active) return;

        if (cameraError) {
          setCameraNotice(cameraError);
          setRecordOptions((prev) => ({ ...prev, webcam: false }));
        }

        if (previewVideoRef.current && stream) {
          previewVideoRef.current.srcObject = stream;
        }

        if (recordOptions.audio && stream) {
          await DualRecordService.getInstance().startMicTest(
            selectedAudioDeviceId,
          );
          if (!active) return;

          const pollLevel = () => {
            const level = DualRecordService.getInstance().getMicLevel();
            if (micLevelRef.current) {
              micLevelRef.current.style.width = `${level * 100}%`;
            }
            animationFrameId = requestAnimationFrame(pollLevel);
          };
          pollLevel();
        }
      } catch (err: any) {
        console.error("[LaunchScreen] Camera/microphone setup failed:", err);
        setPreviewError(
          err?.message ||
            "Could not access camera or microphone. Check System Preferences → Privacy.",
        );
      }
    };

    setupPreviews();

    return () => {
      active = false;
      cancelAnimationFrame(animationFrameId);
      if (!DualRecordService.getInstance().isRecording()) {
        if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
        DualRecordService.getInstance().stopPreview();
        DualRecordService.getInstance().stopScreenPreview();
        DualRecordService.getInstance().stopMicTest();
      }
    };
  }, [
    isRecordOpen,
    recordOptions.webcam,
    recordOptions.audio,
    selectedAudioDeviceId,
    isRecording,
  ]);

  // Project Creation Actions
  const handleStartBlank = (aspectRatio: AspectRatio = "16:9") => {
    const { defaultFrameRate } = useSettingsStore.getState();
    const existingNames = recentProjects.map((p) => p.name);
    const projectName = generateRandomProjectName(existingNames);
    onProjectCreate(projectName, aspectRatio, defaultFrameRate);
  };

  const handleImportMedia = async () => {
    try {
      const selected = await platform.openFileDialog({
        multiple: true,
        filters: [
          {
            name: "Media Files",
            extensions: [
              "mp4",
              "mov",
              "mkv",
              "webm",
              "avi",
              "m4v",
              "mp3",
              "wav",
              "aac",
              "m4a",
              "flac",
              "ogg",
              "png",
              "jpg",
              "jpeg",
              "webp",
            ],
          },
        ],
      });
      if (!selected || selected.length === 0) return;
      const filePaths = selected.map((f) => f.path);
      const { defaultFrameRate } = useSettingsStore.getState();
      const existingNames = recentProjects.map((p) => p.name);
      const projectName = generateRandomProjectName(existingNames);
      onProjectCreate(projectName, "16:9", defaultFrameRate, filePaths);
    } catch (err) {
      console.error("[LaunchScreen] Failed to import media files:", err);
    }
  };

  const handleOpenProjectFile = async () => {
    try {
      const selected = await platform.openFileDialog({
        multiple: false,
        filters: [
          {
            name: "Clypra Project",
            extensions: ["clypra", "json"],
          },
        ],
      });
      if (!selected || selected.length === 0) return;
      const filePath = selected[0].path;
      const projectJson = await platform.loadProject(filePath);
      const parseResult = safeJsonParse<Record<string, unknown>>(projectJson);
      if (!parseResult.success || !parseResult.data) {
        console.error(
          "[LaunchScreen] Security violation or invalid project file:",
          parseResult.error,
        );
        return;
      }
      const parsed = parseResult.data;
      onProjectOpen({
        ...parsed,
        kind: "ready",
        path: filePath,
        backupPath: "",
        backupAvailable: false,
      } as unknown as RecentProjectEntry);
    } catch (err) {
      console.error("[LaunchScreen] Failed to open project file from disk:", err);
    }
  };

  const handleSelectTemplate = async (templateId: string) => {
    try {
      await useProjectStore.getState().createProjectFromTemplate(templateId);
    } catch (err) {
      console.error(
        "[LaunchScreen] Failed to create project from template:",
        err,
      );
    }
  };

  // Rename & Delete Actions
  const handleRenameClick = (project: Project) => {
    setProjectToRename(project);
    setRenameValue(project.name);
  };

  const handleConfirmRename = async () => {
    if (!projectToRename || !renameValue.trim()) return;
    setIsRenaming(true);
    try {
      await renameProject(projectToRename.id, renameValue.trim());
      setProjectToRename(null);
    } catch (error) {
      console.error("Failed to rename project:", error);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeleteClick = (project: Project) => {
    setProjectToDelete(project);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Dual recording trigger
  const openRecordModal = () => {
    resetRecording();
    setIsRecordOpen(true);
  };

  const closeRecordModal = () => {
    if (isRecording) return;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    DualRecordService.getInstance().stopPreview();
    DualRecordService.getInstance().stopMicTest();
    setIsRecordOpen(false);
    setPreviewError(null);
  };

  const startCapture = async () => {
    try {
      setPreviewError(null);
      DualRecordService.getInstance().stopMicTest();

      await DualRecordService.getInstance().startRecording(
        {
          ...recordOptions,
          screenType:
            recordOptions.screenType === "any"
              ? undefined
              : recordOptions.screenType,
          audioDeviceId: selectedAudioDeviceId || undefined,
        },
        (reason) => {
          console.warn(`[LaunchScreen] Recording stopped: ${reason}`);
        },
      );

      setIsRecording(true);
      setSeconds(0);
      setHasWebcam(recordOptions.webcam);

      timerRef.current = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);

      closeRecordModal();
    } catch (err: any) {
      console.error("[LaunchScreen] Start recording failed:", err);
      setPreviewError(
        err?.message ||
          "Could not start screen recording. Please check screen recording permissions in System Preferences.",
      );
      setRecordingError(err?.message || "Recording error occurred");
      resetRecording();
    }
  };

  return (
    <div className="w-full h-full bg-surface-app flex flex-col overflow-hidden text-text-primary select-none">
      {/* 1. Header (Brand, Search, Theme Toggle, Settings) */}
      <LaunchHeader
        isMacNativeWindow={isMacNativeWindow}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenSettings={toggleSettingsModal}
      />

      {/* 2. Scrollable Body Content */}
      <div className="relative z-10 flex-1 flex flex-col w-full px-6 md:px-10 py-6 overflow-y-auto scrollbar-thin">
        {/* Studio Action Hub (New Project, Ratios, Import, Open, Templates) */}
        <StudioActionHub
          onStartBlank={handleStartBlank}
          onImportMedia={handleImportMedia}
          onOpenProjectFile={handleOpenProjectFile}
          onOpenTemplates={() => setTemplatesModalOpen(true)}
        />

        {/* Studio Hardware Capture Suite */}
        <StudioCaptureDock
          onOpenDualRecord={openRecordModal}
          onOpenCameraBooth={openCameraModal}
          onOpenPhoneTransfer={() =>
            useUIStore.getState().setTransferModal(true)
          }
          isDesktop={isDesktop}
        />

        {/* Recent Projects Workspace */}
        <RecentProjectsWorkspace
          projects={recentProjects}
          searchQuery={searchQuery}
          onOpenProject={onProjectOpen}
          onRenameProject={handleRenameClick}
          onDeleteProject={handleDeleteClick}
          onStartBlank={() => handleStartBlank("16:9")}
        />

        {/* Bottom scroll fade */}
        <div
          className="pointer-events-none fixed bottom-0 left-0 right-0 h-10 z-20"
          style={{
            background:
              "linear-gradient(to top, var(--clypra-surface-app) 0%, transparent 100%)",
          }}
        />
      </div>

      {/* ── Rename Project Modal ─────────────────────────────── */}
      <Modal
        isOpen={!!projectToRename}
        onClose={() => setProjectToRename(null)}
        title={t("launch.renameProject")}
      >
        <div className="p-5 space-y-4 bg-surface-floating text-text-primary">
          <div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename();
              }}
              autoFocus
              className="w-full px-3 py-2 rounded-xl bg-surface-input border border-border-default text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
              placeholder={t("project.name")}
            />
            <div className="flex justify-end mt-1.5">
              <span
                className={`text-[10px] font-mono ${
                  countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH
                    ? "text-danger"
                    : "text-text-muted"
                }`}
              >
                {countGraphemes(renameValue)}/{MAX_PROJECT_NAME_LENGTH}
              </span>
            </div>
          </div>
          <div className="flex gap-2.5 justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setProjectToRename(null)}
              disabled={isRenaming}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmRename}
              disabled={
                isRenaming ||
                !renameValue.trim() ||
                countGraphemes(renameValue) > MAX_PROJECT_NAME_LENGTH
              }
              className="rounded-xl bg-accent text-white hover:bg-accent/90"
            >
              {isRenaming ? "Renaming..." : t("launch.rename")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Project Confirmation Modal ─────────────────── */}
      <Modal
        isOpen={!!projectToDelete}
        onClose={() => setProjectToDelete(null)}
        title={t("launch.deleteProject")}
      >
        <div className="p-5 space-y-4 bg-surface-floating text-text-primary">
          <p className="text-xs text-text-primary">
            Are you sure you want to delete{" "}
            <strong>{projectToDelete?.name}</strong>?
          </p>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            {t("project.deleteConfirm")}
          </p>

          <div className="flex gap-2.5 justify-end pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setProjectToDelete(null)}
              disabled={isDeleting}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="rounded-xl bg-danger hover:bg-danger/90 text-white"
            >
              {isDeleting ? "Deleting..." : t("launch.delete")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Dual Recording Modal ─────────────────────────────── */}
      <DualRecordModal
        isOpen={isRecordOpen}
        onClose={closeRecordModal}
        isRecording={isRecording}
        seconds={seconds}
        previewError={previewError}
        cameraNotice={cameraNotice}
        onDismissCameraNotice={() => setCameraNotice(null)}
        recordOptions={recordOptions}
        setRecordOptions={setRecordOptions}
        audioDevices={audioDevices}
        selectedAudioDeviceId={selectedAudioDeviceId}
        setSelectedAudioDeviceId={setSelectedAudioDeviceId}
        previewVideoRef={previewVideoRef}
        micLevelRef={micLevelRef}
        onStartCapture={startCapture}
      />

      {/* ── Project Templates Modal ──────────────────────────── */}
      <ProjectTemplatesModal
        isOpen={templatesModalOpen}
        onClose={() => setTemplatesModalOpen(false)}
        onSelectTemplate={handleSelectTemplate}
      />

      {/* ── Standalone Camera Recording Modal ─────────────────── */}
      <CameraRecordingModal
        onRecordingComplete={(filePath, aspectRatio) => {
          const { defaultFrameRate } = useSettingsStore.getState();
          onProjectCreate("Camera Recording", aspectRatio, defaultFrameRate, [
            filePath,
          ]);
        }}
      />
    </div>
  );
};
