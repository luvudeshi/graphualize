import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { Menu, type MenuItem } from './Menu'
import { GraphMarkIcon, MoonIcon, SearchIcon, SunIcon } from './Icons'
import { applyTransformById, runGraphCommand } from '../state/actions'
import { LAYOUT_LABELS, type LayoutName } from '../graph/layout'
import { TRANSFORMS } from '../graph/transformations'
import { ALGORITHMS } from '../graph/algorithms'
import { formatShortcut } from '../utils/platform'
import { navigate } from '../app/router'
import { AccountMenu } from '../auth/AccountMenu'
import { useTheme } from '../hooks/useTheme'

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
      onSelect: act((s) => s.newDocument()),
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
      onSelect: act((s) => void s.saveCurrent()),
    },
    {
      id: 'duplicate',
      label: 'Duplicate as new',
      onSelect: act((s) => {
        const doc = s.doc
        const name = `${s.name} copy`
        s.newDocument()
        const next = useEditor.getState()
        next.replaceDocument(doc, 'Duplicate graph')
        next.setName(name)
        next.saveCurrent(name)
      }),
    },
    { id: 'import', label: 'Import...', separatorBefore: true, onSelect: () => openDialog('import') },
    { id: 'export', label: 'Export...', onSelect: () => openDialog('export') },
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

  const generateItems: MenuItem[] = [
    { id: 'k5', label: 'Complete K5', onSelect: () => runGraphCommand('K5') },
    { id: 'c6', label: 'Cycle C6', onSelect: () => runGraphCommand('C6') },
    { id: 'p6', label: 'Path P6', onSelect: () => runGraphCommand('P6') },
    { id: 'k33', label: 'Complete bipartite K3,3', onSelect: () => runGraphCommand('K3,3') },
    { id: 'w6', label: 'Wheel W6', onSelect: () => runGraphCommand('W6') },
    { id: 'q3', label: 'Hypercube Q3', onSelect: () => runGraphCommand('Q3') },
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
    separatorBefore: index === 3 || index === 6,
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
      onSelect: act((s) => s.setInspectorOpen(!s.inspectorOpen)),
    },
    {
      id: 'theme-light',
      label: 'Light theme',
      checked: theme === 'light',
      separatorBefore: true,
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
    <header className="flex h-11 shrink-0 items-center gap-0.5 border-b bg-[var(--gz-panel)] px-2">
      <button
        type="button"
        onClick={() => navigate('/')}
        // The visible word is part of the label, so speech control still works.
        aria-label="Graphualize — back to the home page"
        className="gz-btn mr-2 gap-1.5 px-1.5"
      >
        <GraphMarkIcon className="text-[var(--gz-accent)]" />
        <span className="text-[0.875rem] font-semibold tracking-[-0.015em]">Graphualize</span>
      </button>

      <Menu label="File" items={fileItems} />
      <Menu label="Edit" items={editItems} />
      <Menu label="Generate" items={generateItems} />
      <Menu label="Transform" items={transformItems} />
      <Menu label="Algorithms" items={algorithmItems} />
      <Menu label="View" items={viewItems} />
      <Menu label="Help" items={helpItems} />

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="gz-btn border px-2 text-[var(--gz-muted)]"
          onClick={act((s) => s.setCommandPaletteOpen(true))}
          aria-label="Open command palette"
        >
          <SearchIcon width={13} height={13} />
          <span className="gz-num hidden text-[0.6875rem] sm:inline">
            {formatShortcut('mod+K')}
          </span>
        </button>
        <button
          type="button"
          className="gz-btn px-1.5"
          onClick={act((s) => s.setTheme(dark ? 'light' : 'dark'))}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
        <AccountMenu compact />
      </div>
    </header>
  )
}
