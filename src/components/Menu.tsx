import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface MenuItem {
  id: string
  label: string
  /**
   * What is drawn in place of `label`, such as a family's name set as maths.
   * Its text must read the same as `label`, which stays the accessible name.
   */
  labelNode?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /** Renders a divider above this item. */
  separatorBefore?: boolean
  /** Names the group this item opens, as a small-caps rule above it. */
  section?: string
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

/**
 * What goes above an item: a hairline, or a section's name in small capitals
 * ruled off to the right. A separator, so it is never a stop for the arrows.
 */
export const MenuRule = ({ item }: { item: MenuItem }) => {
  if (item.section) {
    return (
      <div role="separator" aria-label={item.section} className="gz-wb-sheet-section">
        {item.section}
      </div>
    )
  }
  return item.separatorBefore ? <div role="separator" className="gz-wb-sheet-rule" /> : null
}

/** A tick in cobalt for an option that is on: a ruled mark, not a glyph. */
const Tick = () => (
  <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
    <path d="M1.5 6.5L4.6 9.5L10.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
)

/** An item's tick column, label and right-aligned italic shortcut. */
export const MenuItemBody = ({ item, tickColumn = true }: { item: MenuItem; tickColumn?: boolean }) => (
  <>
    {tickColumn && <span className="gz-wb-item-check">{item.checked ? <Tick /> : null}</span>}
    <span className="gz-wb-item-label">{item.labelNode ?? item.label}</span>
    {item.shortcut && <span className="gz-wb-item-key">{item.shortcut}</span>}
  </>
)

/** A small keyboard-navigable dropdown used by the menu bar. */
export const Menu = ({ label, items, children, align = 'left' }: MenuProps) => {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  // Where the sheet hangs, from the top of its trigger's box: on the running
  // head's ink rule, whichever row of a wrapped head the trigger sits on.
  const [sheetTop, setSheetTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const root = rootRef.current
      const head = root?.closest('.gz-wb-masthead')
      setSheetTop(
        root && head ? head.getBoundingClientRect().bottom - 1 - root.getBoundingClientRect().top : null,
      )
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

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
        className="gz-wb-menu-trigger"
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
          className={`gz-wb-sheet gz-anim-in absolute top-full z-40 mt-[5px] min-w-60 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={sheetTop === null ? undefined : { top: sheetTop, marginTop: 0 }}
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
              <MenuRule item={item} />
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
                data-danger={item.danger || undefined}
                className="gz-wb-item"
              >
                <MenuItemBody item={item} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
