import { useEffect, useRef } from 'react'
import type { MenuItem } from './Menu'

export interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  label: string
}

/**
 * A right-click menu. Everything here is also reachable from the menu bar, the
 * selection panel or the command palette — this is a shortcut, never the only
 * way to do something.
 */
export const ContextMenu = ({ x, y, items, onClose, label }: ContextMenuProps) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    first?.focus()

    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const nodes = [
        ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
      ]
      if (!nodes.length) return
      const index = nodes.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1
      nodes[(next + nodes.length) % nodes.length]?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Keep the menu inside the viewport rather than letting it hang off an edge.
  const width = 232
  const height = Math.min(items.length * 30 + 12, 340)
  const left = Math.min(x, Math.max(8, window.innerWidth - width - 8))
  const top = Math.min(y, Math.max(8, window.innerHeight - height - 8))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left, top, width }}
      className="gz-anim-pop fixed z-40 rounded-lg border bg-[var(--gz-elevated)] p-1 shadow-[var(--gz-shadow)]"
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="my-1 h-px bg-[var(--gz-border)]" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={`flex w-full items-center gap-3 rounded-md px-2.5 py-[5px] text-left text-[0.8125rem] transition-colors ${
              item.disabled
                ? 'cursor-default opacity-40'
                : 'hover:bg-[color-mix(in_oklab,var(--gz-border)_55%,transparent)] focus:bg-[color-mix(in_oklab,var(--gz-border)_55%,transparent)] focus:outline-none'
            } ${item.danger ? 'text-[var(--gz-danger)]' : ''}`}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="gz-num shrink-0 text-[0.6875rem] text-[var(--gz-faint)]">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
