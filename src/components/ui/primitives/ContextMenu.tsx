import React, { useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface ContextMenuItem {
  label: string
  icon?: LucideIcon
  onClick: () => void
  danger?: boolean
}

export interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
  onClose: () => void
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = () => onClose()

    window.addEventListener('keydown', handleEscape)
    window.addEventListener('click', handleClick)

    return () => {
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('click', handleClick)
    }
  }, [onClose])

  return (
    <div
      className="fixed z-50 bg-surface border border-border rounded shadow-lg min-w-48 py-1"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => {
        const Icon = item.icon
        return (
          <button
            key={idx}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className={`w-full px-3 py-2 text-left flex items-center gap-2 text-sm hover:bg-surface-raised transition-colors ${
              item.danger ? 'text-danger' : 'text-text-primary'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
