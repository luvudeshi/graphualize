import { useState } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import {
  EXPORT_EXTENSIONS,
  EXPORT_LABELS,
  copyToClipboard,
  downloadText,
  exportText,
  importText,
  type ExportFormat,
} from '../state/actions'
import {
  currentPng,
  currentSvg,
  currentTikz,
  defaultDrawingOptions,
  downloadDataUrl,
  type DrawingOptions,
} from '../state/drawing'
import { unicodeLabels } from '../graph/serialization/tikz'

const DATA_FORMATS = Object.keys(EXPORT_LABELS) as ExportFormat[]

/** SVG and PNG share one preview; TikZ is source, so it is shown as text. */
type PictureFormat = 'svg' | 'tikz'

const PICTURE_LABELS: Record<PictureFormat, string> = {
  svg: 'SVG / PNG',
  tikz: 'TikZ',
}

/** A view (`tab`) or one of a set of choices (`toggle`), pressed when chosen. */
const TabButton = ({
  active,
  onClick,
  children,
  look = 'toggle',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  look?: 'tab' | 'toggle'
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={look === 'tab' ? 'gz-wb-dlg-tab' : 'gz-wb-dlg-toggle'}
  >
    {children}
  </button>
)

const Toggle = ({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  children: React.ReactNode
}) => (
  <label className="gz-wb-dlg-check">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    {children}
  </label>
)

export const ExportDialog = ({ open }: { open: boolean }) => (open ? <ExportBody /> : null)

const ExportBody = () => {
  const close = useUi((s) => s.closeDialog)
  const name = useEditor((s) => s.name)
  // Subscribing to the document keeps the preview in step with the canvas.
  useEditor((s) => s.doc)
  const graph = useEditor((s) => s.graph)
  const highlighted = useEditor((s) => s.activeWitness !== null || s.algorithm !== null)
  const notify = useEditor((s) => s.notify)

  const [tab, setTab] = useState<'data' | 'drawing'>('data')
  const [format, setFormat] = useState<ExportFormat>('json')
  const [drawing, setDrawing] = useState<DrawingOptions>(defaultDrawingOptions)
  const [picture, setPicture] = useState<PictureFormat>('svg')
  const [standalone, setStandalone] = useState(false)

  const slug = name.replace(/[^\w-]+/g, '-').toLowerCase() || 'graph'
  const dataText = exportText(format)
  const svg = tab === 'drawing' && picture === 'svg' ? currentSvg(drawing) : ''
  const tikz =
    tab === 'drawing' && picture === 'tikz'
      ? currentTikz({ withHighlight: drawing.withHighlight, standalone })
      : ''
  // Labels pdfLaTeX, Overleaf's default, may not typeset; the source says so
  // in a comment too, but a comment is easy to miss before the compile fails.
  const unicode = tikz ? unicodeLabels(graph) : null

  // What Copy and the main Download act on in the view that is showing.
  const output =
    tab === 'data'
      ? { text: dataText, filename: `${slug}.${EXPORT_EXTENSIONS[format]}` }
      : picture === 'svg'
        ? { text: svg, filename: `${slug}.svg` }
        : { text: tikz, filename: `${slug}.tex` }

  const copyCurrent = async () => {
    const ok = await copyToClipboard(output.text)
    notify(ok ? 'Copied to clipboard.' : 'Clipboard is not available.', ok ? 'success' : 'error')
  }

  const downloadPng = () => {
    const dataUrl = currentPng(drawing)
    if (!dataUrl) {
      notify('There is nothing on the canvas to export yet.', 'error')
      return
    }
    downloadDataUrl(`${slug}.png`, dataUrl)
  }

  return (
    <Dialog
      open
      onClose={close}
      title="Export graph"
      description="Everything is generated from the document you have open right now."
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="gz-btn gz-btn-outline" onClick={() => void copyCurrent()}>
            Copy
          </button>
          {tab === 'drawing' && picture === 'svg' && (
            <button type="button" className="gz-btn gz-btn-outline" onClick={downloadPng}>
              Download {slug}.png
            </button>
          )}
          <button
            type="button"
            className="gz-btn gz-btn-primary"
            onClick={() => downloadText(output.filename, output.text)}
          >
            Download {output.filename}
          </button>
        </>
      }
    >
      <div className="gz-wb-dlg-tabs">
        <TabButton look="tab" active={tab === 'data'} onClick={() => setTab('data')}>
          Data
        </TabButton>
        <TabButton look="tab" active={tab === 'drawing'} onClick={() => setTab('drawing')}>
          Drawing
        </TabButton>
      </div>

      {tab === 'data' ? (
        <>
          <div className="gz-wb-dlg-toggles gz-wb-dlg-toggles-grid">
            {DATA_FORMATS.map((id) => (
              <TabButton key={id} active={id === format} onClick={() => setFormat(id)}>
                {EXPORT_LABELS[id]}
              </TabButton>
            ))}
          </div>
          <pre className="gz-scroll gz-wb-dlg-code max-h-80 whitespace-pre">
            {dataText || '(empty graph)'}
          </pre>
        </>
      ) : (
        <>
          <div className="gz-wb-dlg-toggles">
            {(Object.keys(PICTURE_LABELS) as PictureFormat[]).map((id) => (
              <TabButton key={id} active={id === picture} onClick={() => setPicture(id)}>
                {PICTURE_LABELS[id]}
              </TabButton>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {picture === 'svg' ? (
              <>
                <Toggle
                  checked={drawing.appearance === 'dark'}
                  onChange={(next) =>
                    setDrawing({ ...drawing, appearance: next ? 'dark' : 'light' })
                  }
                >
                  Dark drawing
                </Toggle>
                <Toggle
                  checked={drawing.transparent}
                  onChange={(next) => setDrawing({ ...drawing, transparent: next })}
                >
                  Transparent background
                </Toggle>
              </>
            ) : (
              <Toggle checked={standalone} onChange={setStandalone}>
                Standalone document
              </Toggle>
            )}
            <Toggle
              checked={drawing.withHighlight}
              onChange={(next) => setDrawing({ ...drawing, withHighlight: next })}
            >
              Keep the highlight
            </Toggle>
          </div>
          <p className="gz-wb-dlg-caption mb-3">
            {picture === 'svg' ? (
              <>
                SVG is drawn from the document — real circles, lines and text, so it stays sharp
                and can be edited in Illustrator, Inkscape or LaTeX. PNG is captured from the canvas
                at 2x, so it matches the screen exactly.
              </>
            ) : (
              <>
                TikZ source to paste into a LaTeX document. As a standalone document it compiles on
                its own, on Overleaf or anywhere else.
              </>
            )}
            {highlighted && drawing.withHighlight
              ? ' The highlight currently on screen is included.'
              : ''}
          </p>
          {unicode && unicode.characters.length > 0 && (
            <p role="note" className="gz-wb-dlg-notice mb-3" data-tone="warning">
              Some labels use characters pdfLaTeX, Overleaf's default, may not typeset (
              {unicode.characters.slice(0, 5).join(' ')}
              {unicode.characters.length > 5 ? ' …' : ''}): compile with LuaLaTeX or XeLaTeX
              {unicode.cjk ? ', with a CJK setup such as luatexja' : ''}.
            </p>
          )}
          {picture === 'svg' ? (
            /* The preview is the exact string that will be downloaded; the
               child selectors only scale it down to fit the dialog. */
            <div
              className="gz-wb-dlg-preview"
              style={{ background: drawing.transparent ? undefined : 'var(--gz-paper-light)' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <pre className="gz-scroll gz-wb-dlg-code max-h-80 whitespace-pre">
              {tikz}
            </pre>
          )}
        </>
      )}
    </Dialog>
  )
}

export const ImportDialog = ({ open }: { open: boolean }) => (open ? <ImportBody /> : null)

const ImportBody = () => {
  const close = useUi((s) => s.closeDialog)
  const notify = useEditor((s) => s.notify)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const submit = () => {
    const outcome = importText(text)
    if (!outcome.ok) {
      setError(outcome.message)
      setWarnings([])
      return
    }
    setError(null)
    setWarnings(outcome.warnings)
    notify(outcome.message, 'success')
    if (outcome.warnings.length === 0) close()
  }

  return (
    <Dialog
      open
      onClose={close}
      title="Import graph"
      description="Paste Graphualize JSON, DOT, an adjacency list, an adjacency matrix or a CSV edge list. The format is detected automatically."
      width="max-w-2xl"
      footer={
        <>
          <label className="gz-btn gz-btn-outline mr-auto cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--gz-accent)]">
            Choose file
            <input
              type="file"
              className="sr-only"
              accept=".json,.dot,.gv,.csv,.txt,.graphml,.xml"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setText(await file.text())
                setError(null)
              }}
            />
          </label>
          <button type="button" className="gz-btn gz-btn-outline" onClick={close}>
            Cancel
          </button>
          <button type="button" className="gz-btn gz-btn-primary" onClick={submit}>
            Import
          </button>
        </>
      }
    >
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setError(null)
        }}
        rows={14}
        spellCheck={false}
        aria-label="Graph data to import"
        className="gz-wb-dlg-code block min-h-56 resize-y"
        placeholder={'A: B, C\nB: C\nC:'}
      />
      {error && (
        <p className="gz-wb-dlg-notice mt-3" data-tone="danger">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="gz-wb-dlg-notice mt-3 space-y-1" data-tone="warning">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
