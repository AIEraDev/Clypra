/**
 * Centralized Icon Components
 *
 * All SVG icons organized in one place for easy maintenance and reusability.
 * Each icon accepts standard SVG props (className, width, height, etc.)
 */

import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

/**
 * YouTube/Video Play Icon
 */
export const YouTubeIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    className={className}
    {...props}
  >
    <path d="M0 0h16v16H0z" fill="none" />
    <path
      fill="currentColor"
      d="M15.331 2.502C13.087 2.179 10.607 2 8 2s-5.087.179-7.331.502C.239 4.185 0 6.045 0 8s.239 3.815.669 5.498C2.913 13.821 5.393 14 8 14s5.087-.179 7.331-.502C15.761 11.815 16 9.955 16 8s-.239-3.815-.669-5.498M6 11V5l5 3z"
    />
  </svg>
);

/**
 * Play Icon
 */
export const PlayIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

/**
 * Pause Icon
 */
export const PauseIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

/**
 * Stop Icon
 */
export const StopIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="5" y="5" width="14" height="14" rx="2" ry="2" />
  </svg>
);

/**
 * Skip Forward Icon
 */
export const SkipForwardIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </svg>
);

/**
 * Skip Backward Icon
 */
export const SkipBackwardIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="19 20 9 12 19 4 19 20" />
    <line x1="5" y1="19" x2="5" y2="5" />
  </svg>
);

/**
 * Volume Icon
 */
export const VolumeIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

/**
 * Volume Mute Icon
 */
export const VolumeMuteIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

/**
 * Fullscreen Icon
 */
export const FullscreenIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

/**
 * Exit Fullscreen Icon
 */
export const ExitFullscreenIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
  </svg>
);

/**
 * Settings/Gear Icon
 */
export const SettingsIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v6m0 6v6m9-9h-6m-6 0H3m15.364 6.364l-4.243-4.243m-6 0l-4.242-4.242m12.485 0l-4.243 4.242m-6 0l-4.242 4.243" />
  </svg>
);

/**
 * Plus/Add Icon
 */
export const PlusIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Trash/Delete Icon
 */
export const TrashIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/**
 * Edit/Pencil Icon
 */
export const EditIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

/**
 * Save/Disk Icon
 */
export const SaveIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

/**
 * Folder Icon
 */
export const FolderIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/**
 * Image Icon
 */
export const ImageIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

/**
 * Video Icon
 */
export const VideoIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

/**
 * Music/Audio Icon
 */
export const MusicIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

/**
 * Text Icon
 */
export const TextIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    {...props}
  >
    <path d="M0 0h24v24H0z" fill="none" />
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      d="M12 3H8c-1.886 0-2.828 0-3.414.586S4 5.114 4 7v.95M12 3h4c1.886 0 2.828 0 3.414.586S20 5.114 20 7v.95M12 3v5m0 13v-9m-5 9h10"
    />
  </svg>
);

/**
 * Download Icon
 */
export const DownloadIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/**
 * Upload Icon
 */
export const UploadIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

/**
 * Close/X Icon
 */
export const CloseIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * Check/Checkmark Icon
 */
export const CheckIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * Search Icon
 */
export const SearchIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

/**
 * Filter Icon
 */
export const FilterIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

/**
 * Lock Icon
 */
export const LockIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/**
 * Unlock Icon
 */
export const UnlockIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

/**
 * Eye/Visible Icon
 */
export const EyeIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/**
 * Eye Off/Hidden Icon
 */
export const EyeOffIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/**
 * Scissors/Cut Icon
 */
export const ScissorsIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

/**
 * Copy Icon
 */
export const CopyIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/**
 * Layers Icon
 */
export const LayersIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

/**
 * Zoom In Icon
 */
export const ZoomInIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

/**
 * Zoom Out Icon
 */
export const ZoomOutIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

// ─── Custom Clypra Toolbar Icons ─────────────────────────────────────────────
// Sourced from public/icons/toolbar/. All icons are 24×24 viewBox.
// Paths marked data-accent in the source get stroke="var(--color-accent-primary)".
// Filled accent shapes also receive fill="var(--color-accent-primary)".

/**
 * Undo Icon — curved arrow with accent arrowhead.
 */
export const ToolbarUndoIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* arrowhead — accent */}
    <path d="M8 5 4 9l4 4" stroke="var(--color-accent-primary)" />
    <path d="M4 9h9a5 5 0 0 1 0 10H9" stroke="currentColor" />
  </svg>
);

/**
 * Redo Icon — curved arrow with accent arrowhead.
 */
export const ToolbarRedoIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* arrowhead — accent */}
    <path d="M16 5l4 4-4 4" stroke="var(--color-accent-primary)" />
    <path d="M20 9h-9a5 5 0 0 0 0 10h4" stroke="currentColor" />
  </svg>
);

/**
 * Delete Left (trim start to playhead) Icon — playhead blade, kept clip right, accent X on removed side.
 */
export const ToolbarDeleteLeftIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* playhead */}
    <path d="M14 3v18" stroke="currentColor" />
    {/* kept clip — right of playhead */}
    <path d="M14 8h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5" stroke="currentColor" />
    {/* removed side X — accent */}
    <path d="M4 9l6 6M10 9l-6 6" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Delete Right (trim end to playhead) Icon — playhead blade, kept clip left, accent X on removed side.
 */
export const ToolbarDeleteRightIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* playhead */}
    <path d="M10 3v18" stroke="currentColor" />
    {/* kept clip — left of playhead */}
    <path d="M10 8H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h5" stroke="currentColor" />
    {/* removed side X — accent */}
    <path d="M14 9l6 6M20 9l-6 6" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Split Icon — clip opened at blade, accent blade line.
 */
export const ToolbarSplitIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M8 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3" stroke="currentColor" />
    <path d="M16 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3" stroke="currentColor" />
    {/* blade — accent */}
    <path d="M12 3v18" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Delete (ripple delete) Icon — trash can with accent internal lines.
 */
export const ToolbarDeleteIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M4 6h16M9 6V4h6v2" stroke="currentColor" />
    <path
      d="M6 6l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
      stroke="currentColor"
    />
    {/* internal lines — accent */}
    <path d="M10 10v6M14 10v6" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Duplicate Icon — stacked copy cards with accent foreground rect.
 */
export const ToolbarDuplicateIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* original behind */}
    <path
      d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
      stroke="currentColor"
    />
    {/* copy — accent */}
    <rect
      x="8"
      y="8"
      width="13"
      height="13"
      rx="2"
      stroke="var(--color-accent-primary)"
    />
  </svg>
);

/**
 * Close Gap Icon — two clip edges with accent inward arrows.
 */
export const ToolbarCloseGapIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M3 8v8" stroke="currentColor" />
    <path d="M21 8v8" stroke="currentColor" />
    {/* pull-together arrows — accent */}
    <path
      d="M6 12h4M8 9.5l2.5 2.5L8 14.5M18 12h-4M16 9.5L13.5 12l2.5 2.5"
      stroke="var(--color-accent-primary)"
    />
  </svg>
);

/**
 * Zoom In Icon — magnifier with accent plus.
 */
export const ToolbarZoomInIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="10" cy="10" r="6" stroke="currentColor" />
    <path d="M14.5 14.5L20 20" stroke="currentColor" />
    {/* plus — accent */}
    <path d="M10 7v6M7 10h6" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Zoom Out Icon — magnifier with accent minus.
 */
export const ToolbarZoomOutIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="10" cy="10" r="6" stroke="currentColor" />
    <path d="M14.5 14.5L20 20" stroke="currentColor" />
    {/* minus — accent */}
    <path d="M7 10h6" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Ripple On Icon — two clips with accent shift arrow (ripple active).
 */
export const ToolbarRippleOnIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="3" y="3" width="6" height="5" rx="1.5" stroke="currentColor" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" stroke="currentColor" />
    {/* shift arrow — accent */}
    <path d="M3 16h15M14 12l4 4-4 4" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Ripple Off Icon — two clips with muted arrow and accent strikethrough (ripple inactive).
 */
export const ToolbarRippleOffIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="3" y="3" width="6" height="5" rx="1.5" stroke="currentColor" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" stroke="currentColor" />
    <path d="M3 16h15M14 12l4 4-4 4" stroke="currentColor" />
    {/* strikethrough — accent */}
    <path d="M4 20L20 4" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Snap On Icon — magnet with accent pole bands (snap active).
 */
export const ToolbarSnapOnIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path
      d="M3 4h6v7a3 3 0 0 0 6 0V4h6v7a9 9 0 0 1-18 0z"
      stroke="currentColor"
    />
    {/* pole bands — accent */}
    <path d="M3 8h6M15 8h6" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Snap Off Icon — magnet with accent diagonal strikethrough (snap inactive).
 */
export const ToolbarSnapOffIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path
      d="M3 4h6v7a3 3 0 0 0 6 0V4h6v7a9 9 0 0 1-18 0z"
      stroke="currentColor"
    />
    {/* strikethrough — accent */}
    <path d="M4 4l16 16" stroke="var(--color-accent-primary)" />
  </svg>
);

/**
 * Record Voiceover Icon — microphone with accent filled recording dot.
 */
export const ToolbarRecordVoiceoverIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <rect x="7" y="3" width="6" height="11" rx="3" stroke="currentColor" />
    <path d="M3 11a7 7 0 0 0 14 0" stroke="currentColor" />
    <path d="M10 18v3" stroke="currentColor" />
    {/* recording dot — accent, filled */}
    <circle
      cx="18"
      cy="6"
      r="2"
      stroke="var(--color-accent-primary)"
      fill="var(--color-accent-primary)"
    />
  </svg>
);

// ─── Custom Clypra Icons ──────────────────────────────────────────────────────
// Sourced from public/icons/. Paths with data-accent in the SVG source are
// rendered with stroke="var(--color-accent-primary)" so they always show the
// theme accent regardless of the parent's currentColor state.

/**
 * Assets Tab Icon — dual stacked video frames with an accent play mark.
 * Replaces the Media/Assets sidebar tab icon.
 */
export const AssetsTabIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* front frame */}
    <rect x="3" y="7" width="14" height="12" rx="2" stroke="currentColor" />
    {/* rear frame — only the visible top-right edge */}
    <path
      d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"
      stroke="currentColor"
    />
    {/* play mark — accent slot */}
    <path
      d="M9 10.5v5l4-2.5z"
      stroke="var(--color-accent-primary)"
      fill="var(--color-accent-primary)"
      strokeWidth="1.5"
    />
  </svg>
);

/**
 * Audio Tab Icon — five-bar waveform with an accent center bar.
 * Replaces the Audio sidebar tab icon.
 */
export const AudioTabIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M4 9v6" stroke="currentColor" />
    <path d="M8 5v14" stroke="currentColor" />
    {/* tallest bar — accent slot */}
    <path d="M12 4v16" stroke="var(--color-accent-primary)" />
    <path d="M16 7v10" stroke="currentColor" />
    <path d="M20 10v4" stroke="currentColor" />
  </svg>
);

/**
 * Text Tab Icon — T letterform with a crossbar, stem, and foot.
 * Replaces the Text sidebar tab icon.
 */
export const TextTabIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* top crossbar with dropped ends */}
    <path d="M5 7V5h14v2" stroke="currentColor" />
    {/* stem — accent slot */}
    <path d="M12 5v14" stroke="var(--color-accent-primary)" />
    {/* foot */}
    <path d="M9 19h6" stroke="currentColor" />
  </svg>
);

/**
 * Split At Playhead Icon — playhead cap + blade + two clip halves separated at the cut.
 * Replaces the ScissorsLineDashed split-at-playhead toolbar button.
 */
export const SplitAtPlayheadIcon: React.FC<IconProps> = ({
  size = "1em",
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* playhead cap */}
    <path d="M9 3h6v3l-3 2.5L9 6z" fill="currentColor" strokeWidth="1.5" />
    {/* blade */}
    <path d="M12 9v12" />
    {/* left clip half */}
    <path d="M8.5 12H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3.5" />
    {/* right clip half */}
    <path d="M15.5 12H19a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3.5" />
  </svg>
);
