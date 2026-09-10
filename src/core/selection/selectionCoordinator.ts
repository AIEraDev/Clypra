import { useUIStore } from "@/store/uiStore";

/**
 * Checks whether an event target is an interactive or protected element that
 * MUST NOT trigger deselection when clicked.
 *
 * Protected elements include:
 * 1. Transform overlay and handles ([data-transform-handle], [data-transform-overlay])
 * 2. Preview viewport canvas ([data-testid='program-preview-viewport']) — internal subpixel
 *    canvas hit testing handles its own click cycling and empty-canvas deselection.
 * 3. Properties Inspector ([data-properties-panel], [data-preserve-selection])
 * 4. Timeline interactive elements ([data-clip-id], [data-timeline-clip], [data-timeline-interactive], [data-playhead])
 * 5. Native form inputs & editable content (input, textarea, select, button, a, contenteditable)
 * 6. Accessible interactive roles (menu, dialog, slider, tab, switch, etc.)
 * 7. Radix UI portals, poppers, dropdowns, and color pickers (.clypra-color-picker, [data-color-picker])
 * 8. Panel layout resizers (.resizer-horizontal, .resizer-vertical)
 * 9. Explicit opt-out attributes ([data-interactive='true'], [data-prevent-deselect='true'])
 */
export function isProtectedInteractiveElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }

  // 1. Transform overlay handles and move surfaces
  if (
    target.closest("[data-transform-handle]") ||
    target.closest("[data-transform-overlay]")
  ) {
    return true;
  }

  // 2. Preview canvas viewport (canvas coordinates hit-testing owns this region)
  if (target.closest("[data-testid='program-preview-viewport']")) {
    return true;
  }

  // 3. Properties inspector & selection preservation containers
  if (
    target.closest("[data-properties-panel]") ||
    target.closest("[data-preserve-selection='true']")
  ) {
    return true;
  }

  // 4. Timeline clips and interactive elements (ruler, playhead, track controls)
  if (
    target.closest("[data-clip-id]") ||
    target.closest("[data-timeline-clip]") ||
    target.closest("[data-timeline-interactive='true']") ||
    target.closest("[data-playhead]")
  ) {
    return true;
  }

  // 5. Standard interactive HTML form & contenteditable elements
  if (
    target.closest("input, textarea, select, button, a") ||
    (target as HTMLElement).isContentEditable ||
    target.closest("[contenteditable='true']")
  ) {
    return true;
  }

  // 6. Accessible interactive UI roles
  if (
    target.closest(
      '[role="button"], [role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="option"], [role="combobox"], [role="slider"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]'
    )
  ) {
    return true;
  }

  // 7. Radix UI portals, popovers, dropdowns, tooltips, color pickers
  if (
    target.closest(
      '[data-radix-popper-content-wrapper], [data-radix-portal], [data-radix-collection-item], [data-radix-dropdown-menu-content], [data-radix-select-content], .clypra-color-picker, [data-color-picker]'
    )
  ) {
    return true;
  }

  // 8. Panel layout splitters / resizers
  if (
    target.closest(".resizer-horizontal, .resizer-vertical, [data-panel-resizer]")
  ) {
    return true;
  }

  // 9. Generic interactive markup flags
  if (
    target.closest('[data-interactive="true"], [data-prevent-deselect="true"]')
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether a pointer event on the window represents a neutral-space click
 * that should dismiss the active selection.
 */
export function shouldClearSelectionOnPointerDown(
  target: EventTarget | null,
  button: number = 0,
): boolean {
  // Only primary mouse button (left-click) triggers deselection
  if (button !== 0) return false;

  const uiState = useUIStore.getState();
  const hasSelection =
    uiState.selectedClipIds.length > 0 ||
    uiState.selectedTrackId !== null ||
    uiState.selectedGapId !== null ||
    uiState.selectedTransitionId !== null;

  if (!hasSelection) return false;

  return !isProtectedInteractiveElement(target);
}

/**
 * Clears the active selection across all editor selection categories.
 */
export function clearEditorSelection(): void {
  useUIStore.getState().clearSelection();
}
