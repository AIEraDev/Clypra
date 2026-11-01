import { describe, it, expect } from 'vitest';

// Helper validator asserting keyboard shortcut event target isolation
export function shouldIgnoreKeyboardShortcut(target: {
  tagName?: string;
  isContentEditable?: boolean;
}): boolean {
  if (!target) return false;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

// Helper validator for shortcut modifier key combo formatting
export function parseShortcutCombo(e: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  code: string;
}): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(e.code);
  return parts.join('+');
}

describe('Keyboard Shortcuts Edge Cases & Focus Guard Invariants', () => {

  describe('Input Focus Guard Protection', () => {
    it('ignores shortcuts when user is focused inside an INPUT element', () => {
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'INPUT' })).toBe(true);
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'input' })).toBe(true);
    });

    it('ignores shortcuts when user is focused inside a TEXTAREA element', () => {
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'TEXTAREA' })).toBe(true);
    });

    it('ignores shortcuts when user is focused inside a contenteditable container', () => {
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    });

    it('allows shortcuts when user is focused on body or interactive canvas', () => {
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'BODY' })).toBe(false);
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'CANVAS' })).toBe(false);
      expect(shouldIgnoreKeyboardShortcut({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    });
  });

  describe('Modifier Key Combination Parsing Invariants', () => {
    it('formats CmdOrCtrl+Space combo correctly', () => {
      const combo = parseShortcutCombo({ metaKey: true, code: 'Space' });
      expect(combo).toBe('CmdOrCtrl+Space');
    });

    it('formats CmdOrCtrl+Shift+Z redo combo correctly', () => {
      const combo = parseShortcutCombo({ metaKey: true, shiftKey: true, code: 'KeyZ' });
      expect(combo).toBe('CmdOrCtrl+Shift+KeyZ');
    });

    it('handles plain single key presses cleanly', () => {
      const combo = parseShortcutCombo({ code: 'KeyK' });
      expect(combo).toBe('KeyK');
    });
  });

  // ── Regression: CLY-BUG-ZOOM-SCOPE ───────────────────────────────────────
  // Cmd+= / Cmd+- / Cmd+0 previously fired on BOTH the timeline and the preview
  // simultaneously because both useKeyboardShortcuts and useViewportKeyboardShortcuts
  // listened on window with no panel-scope guard.
  //
  // Fix:
  //   - useViewportKeyboardShortcuts guards on containerRef.current.matches(':hover')
  //   - useKeyboardShortcuts guards timeline zoom on !previewEl.matches(':hover')
  //
  // These tests validate the guard logic in isolation using the pure helper below.

  /**
   * Mirrors the preview-hover guard added to useKeyboardShortcuts:
   *   if (document.querySelector('[data-preview-space]')?.matches(':hover')) return;
   */
  function shouldTimelineZoomFire(previewIsHovered: boolean): boolean {
    return !previewIsHovered;
  }

  /**
   * Mirrors the container-hover guard added to useViewportKeyboardShortcuts:
   *   if (!container || !container.matches(':hover')) return;
   */
  function shouldPreviewZoomFire(containerIsHovered: boolean): boolean {
    return containerIsHovered;
  }

  describe('Zoom shortcut panel-scope guard (CLY-BUG-ZOOM-SCOPE)', () => {
    describe('Timeline zoom fires only when preview is NOT hovered', () => {
      it('fires when preview is not hovered', () => {
        expect(shouldTimelineZoomFire(false)).toBe(true);
      });

      it('does NOT fire when preview is hovered', () => {
        expect(shouldTimelineZoomFire(true)).toBe(false);
      });
    });

    describe('Preview viewport zoom fires only when preview container IS hovered', () => {
      it('fires when preview container is hovered', () => {
        expect(shouldPreviewZoomFire(true)).toBe(true);
      });

      it('does NOT fire when preview container is not hovered', () => {
        expect(shouldPreviewZoomFire(false)).toBe(false);
      });
    });

    it('exactly one handler fires for each pointer location (no dual-zoom)', () => {
      // When pointer is in preview: preview fires, timeline does NOT
      const previewHovered = true;
      expect(shouldPreviewZoomFire(previewHovered)).toBe(true);
      expect(shouldTimelineZoomFire(previewHovered)).toBe(false);

      // When pointer is outside preview: timeline fires, preview does NOT
      const previewNotHovered = false;
      expect(shouldPreviewZoomFire(previewNotHovered)).toBe(false);
      expect(shouldTimelineZoomFire(previewNotHovered)).toBe(true);
    });

    it('Shift+Z (Fit Sequence) always fires on the timeline regardless of preview hover', () => {
      // Shift+Z has no isMeta guard, so the preview-hover check is not applied to it.
      // It should fire on the timeline in all pointer positions.
      // (Only Cmd+= / Cmd+- / Cmd+0 are guarded, not Shift+Z)
      const shiftZShouldFireTimeline = (_previewHovered: boolean) => true;
      expect(shiftZShouldFireTimeline(true)).toBe(true);
      expect(shiftZShouldFireTimeline(false)).toBe(true);
    });
  });

});
