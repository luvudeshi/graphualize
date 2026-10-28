import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { Menu, type MenuItem } from './Menu'
import { CheckIcon, GraphMarkIcon, MoonIcon, SaveIcon, SearchIcon, SunIcon } from './Icons'
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
      className={`gz-btn relative gap-1.5 px-2 ${
        saved ? 'text-[var(--gz-muted)]' : 'border border-[var(--gz-accent)] text-[var(--gz-accent)]'
      }`}
    >
      {saved ? <CheckIcon width={14} height={14} /> : <SaveIcon width={14} height={14} />}
      <span className="hidden text-[0.75rem] font-medium lg:inline">{label}</span>
      {unsaved && !syncing && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--gz-accent)] ring-2 ring-[var(--gz-panel)]"
        />
      )}
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
    // Wraps rather than clipping: where the menus and the right-hand controls
    // do not fit on one line (narrow windows, phones), the controls drop to a
    // second row instead of being pushed off-screen out of reach.
    <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-0.5 border-b bg-[var(--gz-panel)] px-2 py-1">
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

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <SaveButton />
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
