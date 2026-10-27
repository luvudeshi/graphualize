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
import { AboutDialog, ShortcutsDialog } from './components/HelpDialogs'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HomePage } from './home/HomePage'
import { useEditor } from './state/store'
import { useUi } from './state/ui'
import { useShortcuts } from './hooks/useShortcuts'
import { useTheme } from './hooks/useTheme'
import { useRoute } from './app/router'
import { loadExample, runGraphCommand } from './state/actions'
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

/**
 * Runs a graph named in the URL once, then drops it from the address bar so a
 * reload does not overwrite whatever the user has drawn since.
 *
 *   `#/graph?g=K5`               a generator command
 *   `#/graph?g=example:petersen` one of the built-in examples
 *   `#/graph?g=doc:<uuid>`       a graph saved to the signed-in account
 *   `#/graph?g=local:doc-1a2b3c` a graph saved in this browser
 */
const useArrivalCommand = (command: string | null) => {
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current || !command) return
    handled.current = true

    if (command.startsWith('doc:') || command.startsWith('local:')) {
      // openDocument reports both success and failure itself, so this branch
      // deliberately says nothing more.
      const local = command.startsWith('local:')
      void useEditor
        .getState()
        .openDocument(command.slice(local ? 'local:'.length : 'doc:'.length), local ? 'local' : 'cloud')
    } else {
      const example = command.startsWith('example:') ? command.slice('example:'.length) : null
      const ok = example ? loadExample(example) : runGraphCommand(command)
      if (!ok) useEditor.getState().notify(`Could not open "${command}".`, 'error')
    }

    window.history.replaceState(null, '', `${window.location.pathname}#/graph`)
  }, [command])
}

const Editor = ({ command }: { command: string | null }) => {
  useShortcuts()
  useArrivalCommand(command)
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
      {route.name === 'home' ? <HomePage /> : <Editor command={route.command} />}
    </ErrorBoundary>
  )
}

export default App
