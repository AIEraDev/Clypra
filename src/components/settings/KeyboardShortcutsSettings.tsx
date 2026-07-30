import React, { useState, useCallback, useRef } from "react";
import { RotateCcw, Keyboard, Search, AlertTriangle, Check } from "lucide-react";
import { useShortcutStore, formatBinding, getShortcutCategories, type KeyBinding, PRESET_NAME_MAP, type ShortcutPreset } from "@/store/shortcutStore";

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
  onCapture: (binding: KeyBinding) => void;
  onCancel: () => void;
}

function CaptureInput({ onCapture, onCancel }: CaptureInputProps) {
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
      placeholder="Press a key..."
      className="w-full px-2 py-1 text-[11px] font-mono rounded-md bg-accent/10 border border-accent/50 text-accent placeholder:text-accent/50 focus:outline-none focus:border-accent text-center cursor-pointer"
    />
  );
}

// ─── Single shortcut row ───────────────────────────────────────────────────

interface ShortcutRowProps {
  id: string;
  label: string;
  binding: KeyBinding;
  defaultBinding: KeyBinding;
  conflictWith: string | null;
  onEdit: (id: string) => void;
  onReset: (id: string) => void;
  isEditing: boolean;
  onCapture: (id: string, binding: KeyBinding) => void;
  onCancelEdit: () => void;
}

function ShortcutRow({
  id,
  label,
  binding,
  defaultBinding,
  conflictWith,
  onEdit,
  onReset,
  isEditing,
  onCapture,
  onCancelEdit,
}: ShortcutRowProps) {
  const isModified = formatBinding(binding) !== formatBinding(defaultBinding);

  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 px-2 rounded-lg transition-colors ${isEditing ? "bg-accent/6 border border-accent/20" : "hover:bg-white/3 border border-transparent"}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] text-text-primary truncate">{label}</span>
        {conflictWith && (
          <span className="flex items-center gap-0.5 text-[9px] text-amber-400">
            <AlertTriangle className="w-2.5 h-2.5" />
            conflict
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isEditing ? (
          <div className="w-[120px]">
            <CaptureInput
              onCapture={(b) => onCapture(id, b)}
              onCancel={onCancelEdit}
            />
          </div>
        ) : (
          <button
            onClick={() => onEdit(id)}
            className="group relative"
            title="Click to rebind"
          >
            <span className="group-hover:opacity-0 transition-opacity">
              <KeyChip binding={binding} />
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-accent font-medium">
              Edit
            </span>
          </button>
        )}

        <button
          onClick={() => onReset(id)}
          disabled={!isModified}
          title="Reset to default"
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
  const { shortcuts, setShortcut, resetShortcut, resetAll, activePreset, applyPreset } = useShortcutStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [recentlySaved, setRecentlySaved] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const categories = getShortcutCategories();

  // Build conflict map: for each action id, which other action has the same binding?
  const conflictMap = React.useMemo(() => {
    const bindingIndex: Record<string, string> = {};
    const result: Record<string, string | null> = {};

    for (const action of Object.values(shortcuts)) {
      const key = formatBinding(action.binding);
      if (bindingIndex[key] && bindingIndex[key] !== action.id) {
        // Both sides conflict
        result[action.id] = bindingIndex[key];
        result[bindingIndex[key]] = action.id;
      } else {
        bindingIndex[key] = action.id;
        if (result[action.id] === undefined) result[action.id] = null;
      }
    }

    return result;
  }, [shortcuts]);

  const handleEdit = (id: string) => {
    setEditingId(id);
  };

  const handleCapture = (id: string, binding: KeyBinding) => {
    setShortcut(id, binding);
    setEditingId(null);
    setRecentlySaved(id);
    setTimeout(() => setRecentlySaved(null), 1500);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleReset = (id: string) => {
    resetShortcut(id);
  };

  const handleResetAll = () => {
    resetAll();
    setShowResetConfirm(false);
    setEditingId(null);
  };

  const filteredCategories = categories.filter((cat) => {
    const actionsInCat = Object.values(shortcuts).filter(
      (a) =>
        a.category === cat &&
        (!searchQuery || a.label.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    return actionsInCat.length > 0;
  });

  const hasAnyModified = Object.values(shortcuts).some(
    (a) => formatBinding(a.binding) !== formatBinding(a.defaultBinding)
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-muted leading-relaxed max-w-xs">
          Click any binding to rebind it. Press <kbd className="px-1 py-0.5 text-[10px] bg-surface-raised border border-white/10 rounded">Esc</kbd> to cancel.
        </p>

        {showResetConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">Reset all?</span>
            <button
              onClick={handleResetAll}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowResetConfirm(false)}
              className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-surface-raised border border-white/6 text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={!hasAnyModified}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${hasAnyModified ? "bg-surface-raised border border-white/6 text-text-muted hover:text-danger hover:border-danger/40 cursor-pointer" : "bg-surface border border-white/4 text-white/20 cursor-default"}`}
          >
            <RotateCcw className="w-3 h-3" />
            Reset All
          </button>
        )}
      </div>

      {/* Preset selector */}
      <div className="flex items-center justify-between bg-surface-raised p-2.5 rounded-lg border border-white/6">
        <div className="flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-accent" />
          <div>
            <span className="text-[11px] font-medium text-text-primary block">Hotkey Layout Preset</span>
            <span className="text-[10px] text-text-muted">Choose industry standard keybindings</span>
          </div>
        </div>
        <select
          value={activePreset}
          onChange={(e) => applyPreset(e.target.value as ShortcutPreset)}
          className="bg-surface border border-white/10 rounded-md px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent cursor-pointer"
        >
          {Object.entries(PRESET_NAME_MAP).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search shortcuts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-[12px] rounded-lg bg-surface-raised border border-white/6 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40"
        />
      </div>

      {/* Shortcut list by category */}
      <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
        {filteredCategories.length === 0 && (
          <p className="text-center text-[12px] text-text-muted py-8">No shortcuts match "{searchQuery}"</p>
        )}
        {filteredCategories.map((category) => {
          const actionsInCat = Object.values(shortcuts).filter(
            (a) =>
              a.category === category &&
              (!searchQuery || a.label.toLowerCase().includes(searchQuery.toLowerCase()))
          );

          return (
            <section key={category}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 px-2">
                {category}
              </h4>
              <div className="space-y-0.5">
                {actionsInCat.map((action) => (
                  <ShortcutRow
                    key={action.id}
                    id={action.id}
                    label={action.label}
                    binding={action.binding}
                    defaultBinding={action.defaultBinding}
                    conflictWith={conflictMap[action.id] ?? null}
                    isEditing={editingId === action.id}
                    onEdit={handleEdit}
                    onReset={handleReset}
                    onCapture={handleCapture}
                    onCancelEdit={handleCancelEdit}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
