import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface MenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /** Renders a divider above this item. */
  separatorBefore?: boolean
  checked?: boolean
  onSelect: () => void
}

export interface MenuProps {
  label: string
  items: MenuItem[]
  /** Optional custom trigger content. */
  children?: ReactNode
  align?: 'left' | 'right'
}

/** A small keyboard-navigable dropdown used by the menu bar. */
export const Menu = ({ label, items, children, align = 'left' }: MenuProps) => {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    setActiveIndex(-1)
    // Closing unmounts the focused item, so focus would otherwise fall to body.
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      // Clicking elsewhere should move focus there, not snap it back.
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, close])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    nodes?.[activeIndex]?.focus()
  }, [open, activeIndex])

  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0)

  const move = (delta: number) => {
    if (!enabledIndexes.length) return
    const position = enabledIndexes.indexOf(activeIndex)
    const next =
      position === -1
        ? delta > 0
          ? 0
          : enabledIndexes.length - 1
        : (position + delta + enabledIndexes.length) % enabledIndexes.length
    setActiveIndex(enabledIndexes[next]!)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`gz-btn px-2 py-1 ${open ? 'bg-[color-mix(in_oklab,var(--gz-border)_60%,transparent)]' : ''}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
            move(1)
          }
        }}
      >
        {children ?? label}
      </button>
      {open && (
        <div
          id={menuId}
          ref={listRef}
          role="menu"
          aria-label={label}
          className={`gz-anim-in absolute top-full z-40 mt-1 min-w-56 rounded-lg border bg-[var(--gz-elevated)] p-1 shadow-[var(--gz-shadow)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            }
          }}
        >
          {items.map((item, index) => (
            <div key={item.id}>
              {item.separatorBefore && <div className="my-1 h-px bg-[var(--gz-border)]" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
                className={`flex w-full items-center gap-3 rounded-md px-2.5 py-[5px] text-left text-[0.8125rem] transition-colors ${
                  item.disabled
                    ? 'cursor-default opacity-40'
                    : 'hover:bg-[color-mix(in_oklab,var(--gz-border)_55%,transparent)] focus:bg-[color-mix(in_oklab,var(--gz-border)_55%,transparent)] focus:outline-none'
                } ${item.danger ? 'text-[var(--gz-danger)]' : ''}`}
              >
                <span className="w-3 shrink-0 text-[var(--gz-accent)]">
                  {item.checked ? '✓' : ''}
                </span>
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
      )}
    </div>
  )
}
