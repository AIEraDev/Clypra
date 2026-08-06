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

});
