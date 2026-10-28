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

const DATA_FORMATS = Object.keys(EXPORT_LABELS) as ExportFormat[]

/** SVG and PNG share one preview; TikZ is source, so it is shown as text. */
type PictureFormat = 'svg' | 'tikz'

const PICTURE_LABELS: Record<PictureFormat, string> = {
  svg: 'SVG / PNG',
  tikz: 'TikZ',
}

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-md px-2.5 py-1 text-[0.8125rem] transition-colors ${
      active
        ? 'bg-[var(--gz-accent-soft)] text-[var(--gz-accent)]'
        : 'text-[var(--gz-muted)] hover:bg-[color-mix(in_oklab,var(--gz-border)_50%,transparent)]'
    }`}
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
  <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--gz-muted)]">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="accent-[var(--gz-accent)]"
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
          <button type="button" className="gz-btn border px-3" onClick={() => void copyCurrent()}>
            Copy
          </button>
          {tab === 'drawing' && picture === 'svg' && (
            <button type="button" className="gz-btn border px-3" onClick={downloadPng}>
              Download {slug}.png
            </button>
          )}
          <button
            type="button"
            className="gz-btn gz-btn-primary px-3"
            onClick={() => downloadText(output.filename, output.text)}
          >
            Download {output.filename}
          </button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-1 border-b pb-3">
        <TabButton active={tab === 'data'} onClick={() => setTab('data')}>
          Data
        </TabButton>
        <TabButton active={tab === 'drawing'} onClick={() => setTab('drawing')}>
          Drawing
        </TabButton>
      </div>

      {tab === 'data' ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1">
            {DATA_FORMATS.map((id) => (
              <TabButton key={id} active={id === format} onClick={() => setFormat(id)}>
                {EXPORT_LABELS[id]}
              </TabButton>
            ))}
          </div>
          <pre className="gz-scroll gz-num max-h-80 whitespace-pre rounded-lg border bg-[var(--gz-bg)] p-3 text-[0.75rem] leading-relaxed">
            {dataText || '(empty graph)'}
          </pre>
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1">
            {(Object.keys(PICTURE_LABELS) as PictureFormat[]).map((id) => (
              <TabButton key={id} active={id === picture} onClick={() => setPicture(id)}>
                {PICTURE_LABELS[id]}
              </TabButton>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
          <p className="mb-3 text-[0.75rem] leading-relaxed text-[var(--gz-faint)]">
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
          {picture === 'svg' ? (
            /* The preview is the exact string that will be downloaded; the
               child selectors only scale it down to fit the dialog. */
            <div
              className="flex max-h-80 items-center justify-center overflow-hidden rounded-lg border p-3 [&>svg]:h-auto [&>svg]:max-h-72 [&>svg]:w-auto [&>svg]:max-w-full"
              style={{ background: drawing.transparent ? undefined : 'var(--gz-bg)' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <pre className="gz-scroll gz-num max-h-80 whitespace-pre rounded-lg border bg-[var(--gz-bg)] p-3 text-[0.75rem] leading-relaxed">
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
          <label className="gz-btn mr-auto cursor-pointer border px-3">
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
          <button type="button" className="gz-btn border px-3" onClick={close}>
            Cancel
          </button>
          <button type="button" className="gz-btn gz-btn-primary px-3" onClick={submit}>
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
        className="gz-input gz-num min-h-56 resize-y leading-relaxed"
        placeholder={'A: B, C\nB: C\nC:'}
      />
      {error && (
        <p className="mt-2 rounded-md border border-[var(--gz-danger)] bg-[color-mix(in_oklab,var(--gz-danger)_10%,transparent)] px-2.5 py-1.5 text-[0.8125rem] text-[var(--gz-danger)]">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-md border px-2.5 py-1.5 text-[0.8125rem] text-[var(--gz-warning)]">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
