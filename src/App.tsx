import { useEffect, useRef, useState } from 'react'
import { GraphCanvas } from './canvas/GraphCanvas'
import { MenuBar } from './components/MenuBar'
import { Toolbar } from './components/Toolbar'
import { Inspector } from './components/Inspector'
import { AlgorithmPanel } from './components/AlgorithmPanel'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { GenerateDialog } from './components/GenerateDialog'
import { ExamplesDialog } from './components/ExamplesDialog'
import { ExportDialog, ImportDialog } from './components/TransferDialogs'
import { DocumentsDialog } from './components/DocumentsDialog'
import { ConfirmReplace } from './components/ConfirmReplace'
import { ShareLinkDialog } from './components/ShareLinkDialog'
import { replaceWorkingGraph } from './state/replace'
import { AboutDialog, ShortcutsDialog } from './components/HelpDialogs'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HomePage } from './home/HomePage'
import { useEditor } from './state/store'
import { useUi } from './state/ui'
import { useShortcuts } from './hooks/useShortcuts'
import { useTheme } from './hooks/useTheme'
import { useRoute, type Route } from './app/router'
import { loadExample, runGraphCommand } from './state/actions'
import { openSharedGraph } from './state/share'
import { ChevronIcon } from './components/Icons'
import { useAuth } from './auth/store'
import { ConfirmLeave } from './components/ConfirmLeave'

const useIsWide = () => {
  const [wide, setWide] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1024,
  )
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return wide
}

const Dialogs = () => {
  const dialog = useUi((s) => s.dialog)
  const close = useUi((s) => s.closeDialog)
  const shortcutsOpen = useEditor((s) => s.shortcutsOpen)
  const setShortcutsOpen = useEditor((s) => s.setShortcutsOpen)

  return (
    <>
      <GenerateDialog open={dialog === 'generate'} />
      <ExamplesDialog open={dialog === 'examples'} />
      <ImportDialog open={dialog === 'import'} />
      <ExportDialog open={dialog === 'export'} />
      <DocumentsDialog open={dialog === 'documents'} />
      <ConfirmReplace />
      <ShareLinkDialog />
      <AboutDialog open={dialog === 'about'} />
      <ShortcutsDialog
        open={dialog === 'shortcuts' || shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false)
          if (dialog === 'shortcuts') close()
        }}
      />
    </>
  )
}

/** Runs a `?g=` command: a generator, an example, or a saved graph. */
const runArrivalCommand = (command: string) => {
  if (command.startsWith('doc:') || command.startsWith('local:')) {
    // openDocument reports both success and failure itself, so this branch
    // deliberately says nothing more.
    // Through the same guard as File → Open: a link, a bookmark or Back can
    // land here while the canvas holds unsaved work.
    const local = command.startsWith('local:')
    const id = command.slice(local ? 'local:'.length : 'doc:'.length)
    const name = useEditor.getState().documents.find((entry) => entry.id === id)?.name
    replaceWorkingGraph({ kind: 'open', id, source: local ? 'local' : 'cloud', name })
  } else {
    const example = command.startsWith('example:') ? command.slice('example:'.length) : null
    const ok = example ? loadExample(example) : runGraphCommand(command)
    if (!ok) useEditor.getState().notify(`Could not open "${command}".`, 'error')
  }
}

/**
 * Runs a graph named in the URL once, then drops it from the address bar so a
 * reload does not overwrite whatever the user has drawn since.
 *
 *   `#/graph?g=K5`               a generator command
 *   `#/graph?g=example:petersen` one of the built-in examples
 *   `#/graph?g=doc:<uuid>`       a graph saved to the signed-in account
 *   `#/graph?g=local:doc-1a2b3c` a graph saved in this browser
 *   `#/graph?d=1z.…`             a whole graph, carried by a share link
 *
 * A share link wins if both are present, being the more specific of the two.
 * It is opened like a generator command — an undoable replacement, so it needs
 * no unsaved-work guard — and reports both outcomes itself once decoded.
 *
 * Every arrival runs exactly once, including one that comes while the
 * workbench is already open: a link pasted into this tab changes only the
 * hash. `useRoute` parses a fresh route on every hashchange, so the route
 * object itself is the arrival. StrictMode's second run of this effect sees
 * the same one and does nothing — which matters for `doc:` and `local:`, whose
 * one-shot pre-approval must not be spent twice — while the same link pasted
 * again later is a new arrival, and opens again.
 */
const useArrivalCommand = (arrival: Route) => {
  const handled = useRef<Route | null>(null)
  useEffect(() => {
    const { command, shared } = arrival
    if (handled.current === arrival || (!command && !shared)) return
    handled.current = arrival

    if (shared) void openSharedGraph(shared)
    else if (command) runArrivalCommand(command)

    window.history.replaceState(null, '', `${window.location.pathname}#/graph`)
  }, [arrival])
}

const Editor = ({ arrival }: { arrival: Route }) => {
  useShortcuts()
  useArrivalCommand(arrival)
  const wide = useIsWide()
  const inspectorOpen = useEditor((s) => s.inspectorOpen)
  const setInspectorOpen = useEditor((s) => s.setInspectorOpen)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--gz-bg)] text-[var(--gz-text)]">
      <MenuBar />

      <div className="flex min-h-0 flex-1">
        <Toolbar />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <ErrorBoundary>
              <GraphCanvas />
            </ErrorBoundary>
            {!wide && (
              <button
                type="button"
                onClick={() => setInspectorOpen(!inspectorOpen)}
                className="absolute bottom-3 right-3 z-20 rounded-full border bg-[var(--gz-panel)] px-3 py-1.5 text-[0.8125rem] shadow-[var(--gz-shadow)]"
                aria-expanded={inspectorOpen}
              >
                {inspectorOpen ? 'Hide properties' : 'Properties'}
              </button>
            )}
          </div>
          <AlgorithmPanel />
        </main>

        {wide && inspectorOpen && (
          <div className="w-[22rem] shrink-0 xl:w-[24rem]">
            <ErrorBoundary>
              <Inspector />
            </ErrorBoundary>
          </div>
        )}
        {wide && !inspectorOpen && (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="flex w-7 shrink-0 items-center justify-center border-l bg-[var(--gz-panel)] text-[var(--gz-faint)] hover:text-[var(--gz-text)]"
            aria-label="Show inspector"
          >
            <ChevronIcon className="rotate-180" />
          </button>
        )}
      </div>

      {!wide && inspectorOpen && (
        <div className="h-[55vh] shrink-0 border-t">
          <ErrorBoundary>
            <Inspector />
          </ErrorBoundary>
        </div>
      )}

      <StatusBar />
      <CommandPalette />
      <Dialogs />
      <ConfirmLeave />
    </div>
  )
}

export const App = () => {
  useTheme()
  const route = useRoute()
  const initializeAuth = useAuth((s) => s.initialize)

  // Runs once, and no-ops entirely when Supabase is not configured. Nothing
  // below waits on it: the workbench renders and is usable whether or not a
  // session is ever restored.
  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  useEffect(() => {
    document.documentElement.dataset.route = route.name
    if (route.name === 'home') window.scrollTo({ top: 0 })
  }, [route.name])

  return (
    <ErrorBoundary>
      {route.name === 'home' ? (
        <HomePage />
      ) : (
        <Editor arrival={route} />
      )}
    </ErrorBoundary>
  )
}

export default App
