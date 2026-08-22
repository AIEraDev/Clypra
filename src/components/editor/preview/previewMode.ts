// The desktop editor is native-only. Browser/mobile compatibility workspaces
// are separate products and must not change the desktop render authority.
export const PREVIEW_MODE = "native" as const;
export type PreviewMode = typeof PREVIEW_MODE;
