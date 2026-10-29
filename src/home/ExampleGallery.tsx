import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { EXAMPLES } from '../graph/examples'
import { openEditor } from '../app/router'
import { GraphThumbnail } from './GraphThumbnail'

/**
 * The built-in examples as Plate II: a page of numbered figures, each drawn
 * from its own document rather than from a stored picture, so a figure can
 * never disagree with what opens.
 *
 * Set on a twelve-column module, symmetrically, as a plate in a book is: the
 * featured figure in the middle, four small ones either side of it over two
 * rows, and the rest centred on the row beneath. In document order, so the
 * figures are read, and tabbed through, as they are numbered. On a phone it
 * is two columns, with the featured figure across both.
 */
const FEATURED = 'petersen'
/** How many small figures come before the featured one, on its left. */
const BEFORE_FEATURED = 2
/** The small figures that flank the featured one, over its two rows. */
const BESIDE_FEATURED = 8

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/* Symbols instead of letters: a point for vertices, a stroke for edges. */
const VertexGlyph = () => (
  <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true" className="gz-home-fig-glyph">
    <circle cx="4" cy="4" r="3.4" />
  </svg>
)

const EdgeGlyph = () => (
  <svg width={14} height={8} viewBox="0 0 14 8" aria-hidden="true" className="gz-home-fig-glyph">
    <rect x="0" y="2.6" width="14" height="2.8" />
  </svg>
)

/**
 * Sets the named families in a name as mathematics, K5 as an italic K with a
 * subscript 5, to match the quick-start line. The button's accessible name is
 * its label, so this changes only how the caption looks.
 */
const mathName = (name: string): ReactNode[] =>
  name.split(/\b([KCQ])(\d+(?:,\d+)?)\b/).map((part, i, parts) => {
    if (i % 3 === 1) return <i key={i}>{part}</i>
    if (i % 3 === 2) return <sub key={i}>{part}</sub>
    return parts.length === 1 ? part : <span key={i}>{part}</span>
  })

export const ExampleGallery = () => {
  const entries = useMemo(() => {
    const all = EXAMPLES.map((example) => ({ example, doc: example.build() }))
    const featured = all.filter((entry) => entry.example.id === FEATURED)
    const rest = all.filter((entry) => entry.example.id !== FEATURED)
    return [...rest.slice(0, BEFORE_FEATURED), ...featured, ...rest.slice(BEFORE_FEATURED)]
  }, [])
  // The figures left over after the featured one and its flanks are centred
  // on the last row: this is the column the first of them starts in.
  const tail = Math.max(0, entries.length - 1 - BESIDE_FEATURED)
  const tailStart = tail > 0 && tail < 6 ? 7 - tail : 1

  return (
    <div className="gz-home-figs">
      <div className="gz-home-figs-head">
        <span className="gz-demo-plate">Plate II.</span>
        <span className="gz-home-figs-title">The examples</span>
        <span className="gz-home-figs-aside">Each figure opens in the workbench.</span>
      </div>
      <ul className="gz-home-plate">
        {entries.map(({ example, doc }, index) => {
          const big = example.id === FEATURED
          const vertices = doc.vertices.length
          const edges = doc.edges.length
          const blurbId = `home-example-${example.id}`
          const firstOfTail = index === 1 + BESIDE_FEATURED && tail > 0
          return (
            <li
              key={example.id}
              data-big={big || undefined}
              style={firstOfTail ? ({ '--gz-tail-start': tailStart } as CSSProperties) : undefined}
              data-tail={firstOfTail || undefined}
            >
              <button
                type="button"
                onClick={() => openEditor(`example:${example.id}`)}
                // The visible counts are glyphs; the name says them in words.
                aria-label={`${example.name}, ${count(vertices, 'vertex', 'vertices')}, ${count(edges, 'edge', 'edges')}`}
                // The large figure shows its blurb; the small ones keep it for a
                // tooltip, which doubles as their accessible description.
                aria-describedby={big ? blurbId : undefined}
                title={big ? undefined : example.blurb}
                className="gz-home-fig"
                data-big={big || undefined}
              >
                <span className="gz-home-fig-art">
                  <GraphThumbnail
                    doc={doc}
                    width={big ? 420 : 240}
                    height={big ? 300 : 160}
                    padding={big ? 34 : 24}
                    radius={big ? 7 : 4.6}
                  />
                </span>
                <span className="gz-home-fig-caption">
                  <span className="gz-home-fig-no" aria-hidden="true">
                    Fig. {index + 1}.
                  </span>
                  <span className="gz-home-fig-name">{mathName(example.name)}</span>
                  {big && (
                    <span id={blurbId} className="gz-home-fig-blurb">
                      {example.blurb}
                    </span>
                  )}
                  <span className="gz-num gz-home-fig-count text-[var(--gz-muted)]">
                    <span>
                      <VertexGlyph />
                      {vertices}
                    </span>
                    <span>
                      <EdgeGlyph />
                      {edges}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
