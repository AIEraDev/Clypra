import React, { useCallback, useState } from "react";
import { AlertTriangle, RotateCcw, Search } from "lucide-react";
import { t } from "@/i18n";
import {
  SHORTCUT_ACTION_MESSAGE_KEYS,
  SHORTCUT_CATEGORY_MESSAGE_KEYS,
  formatBinding,
  getShortcutCategories,
  useShortcutStore,
  type KeyBinding,
  type ShortcutAction,
  type ShortcutActionId,
  type ShortcutCategory,
} from "@/store/shortcutStore";

function getShortcutActionLabel(
  action: Pick<ShortcutAction, "id">,
): string {
  return t(SHORTCUT_ACTION_MESSAGE_KEYS[action.id]);
}

function getShortcutCategoryLabel(category: ShortcutCategory): string {
  return t(SHORTCUT_CATEGORY_MESSAGE_KEYS[category]);
}

function normalizeShortcutSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\b(?:command|cmd)\b|⌘/g, "ctrl")
    .replace(/\boption\b|⌥/g, "alt");
}

function matchesShortcutSearch(
  action: ShortcutAction,
  category: ShortcutCategory,
  query: string,
): boolean {
  const normalizedQuery = normalizeShortcutSearch(query);
  if (!normalizedQuery) return true;

  return [
    getShortcutActionLabel(action),
    action.searchAlias,
    getShortcutCategoryLabel(category),
    category,
    formatBinding(action.binding),
  ].some((value) => normalizeShortcutSearch(value).includes(normalizedQuery));
}

function ShortcutInstructions() {
  return (
    <>
      {t("settings.shortcuts.instructionsBeforeKey")}
      <kbd className="px-1 py-0.5 text-[10px] bg-surface-raised border border-white/10 rounded">
        Esc
      </kbd>
      {t("settings.shortcuts.instructionsAfterKey")}
    </>
  );
}

// ─── Key chip ──────────────────────────────────────────────────────────────

function KeyChip({ binding }: { binding: KeyBinding }) {
  const parts = formatBinding(binding).split(" ");
  return (
    <span className="flex items-center gap-1">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md text-[10px] font-mono font-semibold bg-surface-raised border border-white/12 text-text-primary shadow-[0_1px_0_0_rgba(255,255,255,0.08)] leading-none"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

// ─── Capture Input ─────────────────────────────────────────────────────────

interface CaptureInputProps {
  actionLabel: string;
  onCapture: (binding: KeyBinding) => void;
  onCancel: () => void;
}

function CaptureInput({ actionLabel, onCapture, onCancel }: CaptureInputProps) {
  const [captured, setCaptured] = useState<KeyBinding | null>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore bare modifier presses
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;
      if (e.key === "Escape") {
        onCancel();
        return;
      }

      const binding: KeyBinding = {
        key: e.key,
        ctrl: e.ctrlKey || e.metaKey || undefined,
        shift: e.shiftKey || undefined,
        alt: e.altKey || undefined,
      };

      // Clean up undefined
      if (!binding.ctrl) delete binding.ctrl;
      if (!binding.shift) delete binding.shift;
      if (!binding.alt) delete binding.alt;

      setCaptured(binding);
      onCapture(binding);
    },
    [onCapture, onCancel]
  );

  return (
    <input
      autoFocus
      readOnly
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      value={captured ? formatBinding(captured) : ""}
      placeholder={t("settings.shortcuts.pressKey")}
      aria-label={t("settings.shortcuts.captureLabel", {
        action: actionLabel,
      })}
      className="w-full px-2 py-1 text-[11px] font-mono rounded-md bg-accent/10 border border-accent/50 text-accent placeholder:text-accent/50 focus:outline-none focus:border-accent text-center cursor-pointer"
    />
  );
}

// ─── Single shortcut row ───────────────────────────────────────────────────

interface ShortcutRowProps {
  id: ShortcutActionId;
  label: string;
  binding: KeyBinding;
  defaultBinding: KeyBinding;
  conflictWithLabel: string | null;
  onEdit: (id: ShortcutActionId) => void;
  onReset: (id: ShortcutActionId) => void;
  isEditing: boolean;
  onCapture: (id: ShortcutActionId, binding: KeyBinding) => void;
  onCancelEdit: () => void;
}

function ShortcutRow({
  id,
  label,
  binding,
  defaultBinding,
  conflictWithLabel,
  onEdit,
  onReset,
  isEditing,
  onCapture,
  onCancelEdit,
}: ShortcutRowProps) {
  const formattedBinding = formatBinding(binding);
  const isModified = formattedBinding !== formatBinding(defaultBinding);
  const conflictDescriptionId = conflictWithLabel
    ? `shortcut-conflict-${id}`
    : undefined;

  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 px-2 rounded-lg transition-colors ${isEditing ? "bg-accent/6 border border-accent/20" : "hover:bg-white/3 border border-transparent"}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] text-text-primary truncate">{label}</span>
        {conflictWithLabel && (
          <span
            id={conflictDescriptionId}
            className="flex items-center gap-0.5 text-[9px] text-amber-400"
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            {t("settings.shortcuts.conflictWith", {
              action: conflictWithLabel,
            })}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isEditing ? (
          <div className="w-[120px]">
            <CaptureInput
              actionLabel={label}
              onCapture={(b) => onCapture(id, b)}
              onCancel={onCancelEdit}
            />
          </div>
        ) : (
          <button
            onClick={() => onEdit(id)}
            className="group relative"
            title={t("settings.shortcuts.clickToRebind", { action: label })}
            aria-label={t("settings.shortcuts.rebindLabel", {
              action: label,
              binding: formattedBinding,
            })}
            aria-describedby={conflictDescriptionId}
          >
            <span className="group-hover:opacity-0 transition-opacity">
              <KeyChip binding={binding} />
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-accent font-medium">
              {t("settings.shortcuts.edit")}
            </span>
          </button>
        )}

        <button
          onClick={() => onReset(id)}
          disabled={!isModified}
          title={t("settings.shortcuts.resetLabel", { action: label })}
          aria-label={t("settings.shortcuts.resetLabel", { action: label })}
          className={`p-1 rounded transition-colors ${isModified ? "text-text-muted hover:text-accent cursor-pointer" : "text-white/10 cursor-default"}`}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function KeyboardShortcutsSettings() {
  const { shortcuts, setShortcut, resetShortcut, resetAll } = useShortcutStore();
  const [editingId, setEditingId] = useState<ShortcutActionId | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const categories = getShortcutCategories();
  const actions = Object.values(shortcuts);

  // Build conflict map: for each action id, which other action has the same binding?
  const conflictMap = React.useMemo(() => {
    const bindingIndex: Record<string, ShortcutActionId | undefined> = {};
    const result: Partial<Record<ShortcutActionId, ShortcutActionId>> = {};

    for (const action of Object.values(shortcuts)) {
      const key = formatBinding(action.binding);
      const existingActionId = bindingIndex[key];
      if (existingActionId && existingActionId !== action.id) {
        // Both sides conflict
        result[action.id] = existingActionId;
        result[existingActionId] = action.id;
      } else {
        bindingIndex[key] = action.id;
      }
    }

    return result;
  }, [shortcuts]);

  const handleEdit = (id: ShortcutActionId) => {
    setEditingId(id);
  };

  const handleCapture = (id: ShortcutActionId, binding: KeyBinding) => {
    setShortcut(id, binding);
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleReset = (id: ShortcutActionId) => {
    resetShortcut(id);
  };

  const handleResetAll = () => {
    resetAll();
    setShowResetConfirm(false);
    setEditingId(null);
  };

  const filteredCategories = categories.filter((cat) => {
    const actionsInCat = actions.filter(
      (action) =>
        action.category === cat &&
        matchesShortcutSearch(action, cat, searchQuery),
    );
    return actionsInCat.length > 0;
  });

  const hasAnyModified = actions.some(
    (a) => formatBinding(a.binding) !== formatBinding(a.defaultBinding),
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-muted leading-relaxed max-w-xs">
          <ShortcutInstructions />
        </p>

        {showResetConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">
              {t("settings.shortcuts.resetAllQuestion")}
            </span>
            <button
              onClick={handleResetAll}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
            >
              {t("settings.shortcuts.confirm")}
            </button>
            <button
              onClick={() => setShowResetConfirm(false)}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary transition-colors"
            >
              {t("settings.shortcuts.cancel")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={!hasAnyModified}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${hasAnyModified ? "bg-surface-raised border border-white/6 text-text-muted hover:text-danger hover:border-danger/40 cursor-pointer" : "bg-surface border border-white/4 text-white/20 cursor-default"}`}
          >
            <RotateCcw className="w-3 h-3" />
            {t("settings.shortcuts.resetAll")}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          type="text"
          placeholder={t("settings.shortcuts.searchPlaceholder")}
          aria-label={t("settings.shortcuts.searchLabel")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-[12px] rounded-lg bg-surface-raised border border-white/6 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
        />
      </div>

      {/* Shortcut list by category */}
      <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
        {filteredCategories.length === 0 && (
          <p className="text-center text-[12px] text-text-muted py-8">
            {t("settings.shortcuts.noMatches", { query: searchQuery })}
          </p>
        )}
        {filteredCategories.map((category) => {
          const actionsInCat = actions.filter(
            (action) =>
              action.category === category &&
              matchesShortcutSearch(action, category, searchQuery),
          );

          return (
            <section key={category}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 px-2">
                {getShortcutCategoryLabel(category)}
              </h4>
              <div className="space-y-0.5">
                {actionsInCat.map((action) => {
                  const conflictActionId = conflictMap[action.id];
                  const conflictAction = conflictActionId
                    ? shortcuts[conflictActionId]
                    : undefined;

                  return (
                    <ShortcutRow
                      key={action.id}
                      id={action.id}
                      label={getShortcutActionLabel(action)}
                      binding={action.binding}
                      defaultBinding={action.defaultBinding}
                      conflictWithLabel={
                        conflictAction
                          ? getShortcutActionLabel(conflictAction)
                          : null
                      }
                      isEditing={editingId === action.id}
                      onEdit={handleEdit}
                      onReset={handleReset}
                      onCapture={handleCapture}
                      onCancelEdit={handleCancelEdit}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
