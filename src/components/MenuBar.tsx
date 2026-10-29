import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { Menu, type MenuItem } from './Menu'
import { CheckIcon, SaveIcon, SearchIcon } from './Icons'
import { applyTransformById, runGraphCommand } from '../state/actions'
import { LAYOUT_LABELS, type LayoutName } from '../graph/layout'
import { TRANSFORMS } from '../graph/transformations'
import { ALGORITHMS } from '../graph/algorithms'
import { formatShortcut } from '../utils/platform'
import { navigate } from '../app/router'
import { AccountMenu } from '../auth/AccountMenu'
import { useTheme } from '../hooks/useTheme'
import { replaceWorkingGraph } from '../state/replace'
import { copyShareLink } from '../state/share'
import { requestSave, requestSaveAs } from '../state/save'
import '../styles/header.css'

/** The app's mark in the Byrne inks, as on the home page: three points, three primaries. */
const BrandMark = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" className="gz-wb-brandmark" aria-hidden="true">
    <path d="M5 6.5L21 9.5L11.5 21Z" className="gz-wb-brandmark-edges" />
    <circle cx="5" cy="6.5" r="3.6" data-ink="red" />
    <circle cx="21" cy="9.5" r="3.6" data-ink="blue" />
    <circle cx="11.5" cy="21" r="3.6" data-ink="yellow" />
  </svg>
)

/* The theme toggle's two states as flat shapes, the home page's own: an ink
   crescent for the night edition, a yellow sun for the day. */
const MoonGlyph = () => (
  <svg width={19} height={19} viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8.82 3.09A7.5 7.5 0 1 0 17.41 11.68A6.2 6.2 0 0 1 8.82 3.09Z" fill="currentColor" />
  </svg>
)

const SunGlyph = () => (
  <svg width={19} height={19} viewBox="0 0 20 20" aria-hidden="true" className="gz-wb-sun">
    <circle cx="10" cy="10" r="4.2" />
    <path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1" />
  </svg>
)

/**
 * A family's name with its symbol set as maths, as in the Generate dialog and
 * on the home page: an italic letter and a subscript. Its text still reads
 * "Complete K5", so the item's accessible name is unchanged.
 */
const FamilyName = ({ name, letter, size }: { name: string; letter: string; size: string }) => (
  <>
    {name}{' '}
    <span className="gz-wb-item-math">
      <i>{letter}</i>
      <sub>{size}</sub>
    </span>
  </>
)

/**
 * Save, where it can be seen. Its label is the graph's save state — Save with
 * a dot while there is unsaved work, Saving… while a save is out, Saved once
 * it is kept — so whether a graph is safe is never something to go looking
 * for in a menu or the status bar.
 */
const SaveButton = () => {
  const dirty = useEditor((s) => s.dirty)
  const syncing = useEditor((s) => s.syncing)
  const savedId = useEditor((s) => s.savedId)
  const hasContent = useEditor((s) => s.doc.vertices.length > 0)
  const saved = savedId !== null && !dirty
  const unsaved = !saved && (hasContent || savedId !== null)

  const label = syncing ? 'Saving…' : saved ? 'Saved' : 'Save'
  return (
    // aria-disabled, not disabled: a disabled button that has focus drops it
    // to <body> mid-save. requestSave already ignores a press while saving.
    <button
      type="button"
      data-save-button
      onClick={() => requestSave()}
      aria-disabled={syncing || undefined}
      aria-label={
        syncing ? 'Saving' : saved ? 'Saved — no unsaved changes' : unsaved ? 'Save (unsaved changes)' : 'Save'
      }
      title={`Save (${formatShortcut('mod+S')})`}
      data-state={syncing ? 'saving' : saved ? 'saved' : 'unsaved'}
      className="gz-wb-save"
    >
      {saved ? <CheckIcon width={15} height={15} /> : <SaveIcon width={15} height={15} />}
      <span className="hidden lg:inline">{label}</span>
      {unsaved && !syncing && <span aria-hidden className="gz-wb-save-dot" />}
    </button>
  )
}

export const MenuBar = () => {
  const openDialog = useUi((s) => s.openDialog)
  const { dark } = useTheme()

  // Only subscribe to what changes a menu item's appearance. Actions are read
  // from the store at click time so playback never re-renders this bar.
  const graph = useEditor((s) => s.graph)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const directed = useEditor((s) => s.doc.directed)
  const weighted = useEditor((s) => s.doc.weighted)
  const inspectorOpen = useEditor((s) => s.inspectorOpen)
  const theme = useEditor((s) => s.theme)
  const selectedVertices = useEditor((s) => s.selectedVertices)
  const selectedEdges = useEditor((s) => s.selectedEdges)
  const hasAlgorithm = useEditor((s) => s.algorithm !== null)

  const act = <T extends unknown[]>(fn: (state: ReturnType<typeof useEditor.getState>, ...args: T) => void) =>
    (...args: T) => fn(useEditor.getState(), ...args)

  const fileItems: MenuItem[] = [
    {
      id: 'new',
      label: 'New graph',
      shortcut: formatShortcut('mod+N'),
      onSelect: () => replaceWorkingGraph({ kind: 'new' }),
    },
    {
      id: 'open',
      label: 'Open...',
      shortcut: formatShortcut('mod+O'),
      onSelect: () => openDialog('documents'),
    },
    { id: 'examples', label: 'Example gallery', onSelect: () => openDialog('examples') },
    {
      id: 'save',
      label: 'Save',
      shortcut: formatShortcut('mod+S'),
      separatorBefore: true,
      onSelect: () => requestSave(),
    },
    {
      id: 'saveAs',
      label: 'Save as...',
      shortcut: formatShortcut('mod+shift+S'),
      onSelect: () => requestSaveAs(),
    },
    { id: 'import', label: 'Import...', separatorBefore: true, onSelect: () => openDialog('import') },
    { id: 'export', label: 'Export...', onSelect: () => openDialog('export') },
    {
      id: 'share',
      label: 'Copy share link',
      // Not disabled on a page opened from disk, where no link can be made: a
      // greyed-out item cannot say why, so choosing it says so instead.
      disabled: graph.order === 0,
      onSelect: () => void copyShareLink(),
    },
  ]

  const editItems: MenuItem[] = [
    {
      id: 'undo',
      label: 'Undo',
      shortcut: formatShortcut('mod+Z'),
      disabled: !canUndo,
      onSelect: act((s) => s.undo()),
    },
    {
      id: 'redo',
      label: 'Redo',
      shortcut: formatShortcut('mod+shift+Z'),
      disabled: !canRedo,
      onSelect: act((s) => s.redo()),
    },
    {
      id: 'selectAll',
      label: 'Select all',
      shortcut: formatShortcut('mod+A'),
      separatorBefore: true,
      onSelect: act((s) => s.select(s.graph.vertexIds, s.graph.edgeIds)),
    },
    { id: 'deselect', label: 'Deselect', shortcut: 'Esc', onSelect: act((s) => s.clearSelection()) },
    {
      id: 'delete',
      label: 'Delete selection',
      shortcut: 'Del',
      disabled: !selectedVertices.length && !selectedEdges.length,
      onSelect: act((s) => s.deleteSelection()),
    },
    {
      id: 'directed',
      label: 'Directed graph',
      checked: directed,
      separatorBefore: true,
      section: 'The graph',
      onSelect: act((s) => s.setDirected(!s.doc.directed)),
    },
    {
      id: 'weighted',
      label: 'Weighted edges',
      checked: weighted,
      onSelect: act((s) => s.setWeighted(!s.doc.weighted)),
    },
    {
      id: 'clear',
      label: 'Clear graph',
      danger: true,
      separatorBefore: true,
      onSelect: act((s) => s.clearGraph()),
    },
  ]

  const family = (id: string, name: string, letter: string, size: string): MenuItem => ({
    id,
    label: `${name} ${letter}${size}`,
    labelNode: <FamilyName name={name} letter={letter} size={size} />,
    onSelect: () => runGraphCommand(`${letter}${size}`),
  })

  const generateItems: MenuItem[] = [
    { ...family('k5', 'Complete', 'K', '5'), section: 'Families' },
    family('c6', 'Cycle', 'C', '6'),
    family('p6', 'Path', 'P', '6'),
    family('k33', 'Complete bipartite', 'K', '3,3'),
    family('w6', 'Wheel', 'W', '6'),
    family('q3', 'Hypercube', 'Q', '3'),
    { id: 'petersen', label: 'Petersen graph', onSelect: () => runGraphCommand('Petersen') },
    {
      id: 'more',
      label: 'All generators...',
      separatorBefore: true,
      onSelect: () => openDialog('generate'),
    },
  ]

  const transformItems: MenuItem[] = TRANSFORMS.map((transform, index) => ({
    id: transform.id,
    label: transform.name,
    // Index 10 starts the edge-weight transforms.
    separatorBefore: index === 3 || index === 6 || index === 10,
    disabled: Boolean(
      transform.precondition?.(graph, { selectedVertices, selectedEdges }),
    ),
    onSelect: () => applyTransformById(transform.id),
  }))

  const algorithmItems: MenuItem[] = [
    ...ALGORITHMS.map((algorithm) => ({
      id: algorithm.id,
      label: algorithm.name,
      onSelect: act((s) => s.startAlgorithm(algorithm.id)),
    })),
    {
      id: 'exit',
      label: 'Exit visualisation',
      separatorBefore: true,
      disabled: !hasAlgorithm,
      onSelect: act((s) => s.stopAlgorithm()),
    },
  ]

  const viewItems: MenuItem[] = [
    { id: 'fit', label: 'Fit to screen', shortcut: 'F', onSelect: act((s) => s.requestView('fit')) },
    { id: 'reset', label: 'Reset view', onSelect: act((s) => s.requestView('reset')) },
    {
      id: 'inspector',
      label: 'Inspector panel',
      checked: inspectorOpen,
      separatorBefore: true,
      section: 'Panels',
      onSelect: act((s) => s.setInspectorOpen(!s.inspectorOpen)),
    },
    {
      id: 'theme-light',
      label: 'Light theme',
      checked: theme === 'light',
      separatorBefore: true,
      section: 'Theme',
      onSelect: act((s) => s.setTheme('light')),
    },
    {
      id: 'theme-dark',
      label: 'Dark theme',
      checked: theme === 'dark',
      onSelect: act((s) => s.setTheme('dark')),
    },
    {
      id: 'theme-system',
      label: 'Match system',
      checked: theme === 'system',
      onSelect: act((s) => s.setTheme('system')),
    },
    ...(Object.keys(LAYOUT_LABELS) as LayoutName[])
      .filter((name) => name !== 'bipartite')
      .map((name, index) => ({
        id: `layout-${name}`,
        label: `Layout: ${LAYOUT_LABELS[name]}`,
        separatorBefore: index === 0,
        section: index === 0 ? 'Layout' : undefined,
        onSelect: act((s) => s.runLayout(name)),
      })),
  ]

  const helpItems: MenuItem[] = [
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      shortcut: '?',
      onSelect: () => openDialog('shortcuts'),
    },
    { id: 'about', label: 'About Graphualize', onSelect: () => openDialog('about') },
  ]

  return (
    // Wraps rather than clipping: where the menus and the right-hand controls
    // do not fit on one line (narrow windows, phones), the controls drop to a
    // second row instead of being pushed off-screen out of reach.
    <header className="gz-wb-masthead">
      <button
        type="button"
        onClick={() => navigate('/')}
        // The visible word is part of the label, so speech control still works.
        aria-label="Graphualize — back to the home page"
        className="gz-wb-brand"
      >
        <BrandMark />
        <span className="gz-wb-brand-word">Graphualize</span>
      </button>

      <Menu label="File" items={fileItems} />
      <Menu label="Edit" items={editItems} />
      <Menu label="Generate" items={generateItems} />
      <Menu label="Transform" items={transformItems} />
      <Menu label="Algorithms" items={algorithmItems} />
      <Menu label="View" items={viewItems} />
      <Menu label="Help" items={helpItems} />

      <div className="gz-wb-tools">
        <SaveButton />
        <button
          type="button"
          className="gz-wb-find-btn"
          onClick={act((s) => s.setCommandPaletteOpen(true))}
          aria-label="Open command palette"
        >
          <SearchIcon width={14} height={14} />
          <kbd className="hidden sm:inline">{formatShortcut('mod+K')}</kbd>
        </button>
        <button
          type="button"
          className="gz-wb-icon-btn"
          onClick={act((s) => s.setTheme(dark ? 'light' : 'dark'))}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {dark ? <SunGlyph /> : <MoonGlyph />}
        </button>
        <AccountMenu compact />
      </div>
    </header>
  )
}
