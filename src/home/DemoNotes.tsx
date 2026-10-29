import { memo, useMemo } from 'react'
import { notebook, GLYPH, GLYPH_GAP, roughMeasure, type Lettering, type Measure, type Note, type Plot, type Subject } from './notes'
import type { Glyph, Ink } from './byrne'

/** The notes' italic, at the size home.css sets them in. */
const noteFont = (compact: boolean) => `italic 500 ${compact ? 15.5 : 17}px "EB Garamond"`

/**
 * Measures the notes' lettering in the face it is set in. jsdom has no
 * canvas, so there (and anywhere else without one) an estimate stands in.
 */
const measurer = (compact: boolean): Measure => {
  if (typeof window === 'undefined' || typeof window.CanvasRenderingContext2D !== 'function') {
    return compact ? (text) => roughMeasure(text) * 0.92 : roughMeasure
  }
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return roughMeasure
  const font = noteFont(compact)
  context.font = font
  const cache = new Map<string, number>()
  return (text) => {
    let width = cache.get(text)
    if (width === undefined) {
      width = context.measureText(text).width
      // Only remembered once the face itself has arrived: a width taken from
      // the fallback face is used once and measured again next time.
      if (document.fonts?.check(font) !== false) cache.set(text, width)
    }
    return width
  }
}

/** The property's glyph, centred on a point: the same shape the list shows. */
const GlyphMark = ({ glyph, x, y }: { glyph: Glyph; x: number; y: number }) => {
  const h = GLYPH / 2
  switch (glyph) {
    case 'triangle':
      return (
        <polygon
          points={`${x},${y - h} ${x + h},${y + h - 1} ${x - h},${y + h - 1}`}
          className="gz-demo-note-glyph"
        />
      )
    case 'bar':
      return <rect x={x - h} y={y - 2} width={GLYPH} height={4} className="gz-demo-note-glyph" />
    case 'disc':
      return <circle cx={x} cy={y} r={h - 0.5} className="gz-demo-note-glyph" />
    default:
      return <rect x={x - h + 1} y={y - h + 1} width={GLYPH - 2} height={GLYPH - 2} className="gz-demo-note-glyph" />
  }
}

const Words = ({ lettering, glyph }: { lettering: Lettering; glyph: Glyph }) => {
  const { centre, width, angle, text } = lettering
  const left = centre.x - width / 2
  return (
    <g transform={angle ? `rotate(${angle} ${centre.x} ${centre.y})` : undefined}>
      <GlyphMark glyph={glyph} x={left + GLYPH / 2} y={centre.y} />
      {text && (
        <text x={left + GLYPH + GLYPH_GAP} y={centre.y} dy="0.32em" className="gz-demo-note-text">
          {text}
        </text>
      )}
    </g>
  )
}

const line = ([p, q]: [{ x: number; y: number }, { x: number; y: number }]) =>
  `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`

const NoteMark = ({ note, glyph }: { note: Note; glyph: Glyph }) => {
  switch (note.kind) {
    case 'leader':
      return (
        <g>
          <path d={line([note.from, note.to])} className="gz-demo-note-rule" />
          <circle cx={note.from.x} cy={note.from.y} r={1.9} className="gz-demo-note-dot" />
          <Words lettering={note.lettering} glyph={glyph} />
        </g>
      )
    case 'mark':
      return <GlyphMark glyph={glyph} x={note.at.x} y={note.at.y} />
    case 'dimension':
      return (
        <g>
          {note.extensions.map((extension, i) => (
            <path key={i} d={line(extension)} className="gz-demo-note-extension" />
          ))}
          <path d={line(note.line)} className="gz-demo-note-rule" />
          {note.ticks.map((tick, i) => (
            <path key={i} d={line(tick)} className="gz-demo-note-rule" />
          ))}
          <Words lettering={note.lettering} glyph={glyph} />
        </g>
      )
  }
}

/**
 * The notes written on the plate beside the property on show (see notes.ts),
 * in italic with a thin leader in the property's ink. Decorative: the
 * property list says the same in words, so this is hidden from assistive
 * technology.
 */
export const DemoNotes = memo(function DemoNotes({
  plot,
  subject,
  ink,
  glyph,
  compact,
}: {
  plot: Plot | null
  subject: Subject | null
  ink: Ink
  glyph: Glyph
  compact: boolean
}) {
  const measure = useMemo(() => measurer(compact), [compact])
  // Remembers what it wrote a frame ago, so that while a vertex is dragged
  // each note keeps to its spot for as long as it fits there.
  const write = useMemo(() => notebook(), [])
  const notes = useMemo(
    () => (plot && subject ? write(subject, plot, measure) : []),
    [write, plot, subject, measure],
  )
  if (!plot) return null
  return (
    <svg
      className="gz-demo-notes"
      data-ink={ink}
      data-compact={compact || undefined}
      width={plot.width}
      height={plot.height}
      aria-hidden="true"
      focusable="false"
    >
      {/* Keyed by property, so each new one is written in afresh while a drag
          only moves what is already there. */}
      <g key={subject?.id ?? 'none'} className="gz-demo-notes-in">
        {notes.map((note, i) => (
          <NoteMark key={i} note={note} glyph={glyph} />
        ))}
      </g>
    </svg>
  )
})
