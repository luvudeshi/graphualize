import { useEffect, useRef } from 'react'
import { MenuItemBody, MenuRule, type MenuItem } from './Menu'

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
  const width = 240
  const height = Math.min(
    items.length * 30 + items.filter((item) => item.separatorBefore || item.section).length * 13 + 14,
    360,
  )
  const left = Math.min(x, Math.max(8, window.innerWidth - width - 8))
  const top = Math.min(y, Math.max(8, window.innerHeight - height - 8))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left, top, width }}
      className="gz-wb-sheet gz-anim-pop fixed z-40"
    >
      {items.map((item) => (
        <div key={item.id}>
          <MenuRule item={item} />
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            data-danger={item.danger || undefined}
            className="gz-wb-item"
          >
            <MenuItemBody item={item} tickColumn={items.some((entry) => entry.checked !== undefined)} />
          </button>
        </div>
      ))}
    </div>
  )
}
