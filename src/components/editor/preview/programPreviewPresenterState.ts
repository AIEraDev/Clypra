/**
 * Shared, ephemeral presenter decision for program-preview consumers.
 *
 * This is intentionally outside React/Zustand: it changes at frame cadence
 * and is not project state. The transform overlay only subscribes so it can
 * choose geometry from the same presenter as the visible program frame.
 */
export type ProgramPreviewPresenter = "native-surface" | "dom-canvas";

let activeProgramPreviewPresenter: ProgramPreviewPresenter | null = null;
const listeners = new Set<() => void>();

export function getActiveProgramPreviewPresenter(): ProgramPreviewPresenter | null {
  return activeProgramPreviewPresenter;
}

export function subscribeToActiveProgramPreviewPresenter(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveProgramPreviewPresenter(
  presenter: ProgramPreviewPresenter | null,
): void {
  if (activeProgramPreviewPresenter === presenter) return;
  activeProgramPreviewPresenter = presenter;
  listeners.forEach((listener) => listener());
}
