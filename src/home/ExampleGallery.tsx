import { useMemo } from 'react'
import { EXAMPLES } from '../graph/examples'
import { openEditor } from '../app/router'
import { GraphThumbnail } from './GraphThumbnail'

/**
 * The built-in examples, each drawn from its own document rather than from a
 * stored picture, so a thumbnail can never disagree with what opens.
 *
 * One example gets a large tile. With it the twelve others fill a four-column
 * grid exactly (and a two-column one on a phone), instead of leaving one card
 * stranded on the last row.
 */
const FEATURED = 'petersen'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const VertexGlyph = () => (
  <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
    <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)

const EdgeGlyph = () => (
  <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 8L8 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

export const ExampleGallery = () => {
  const entries = useMemo(() => {
    const all = EXAMPLES.map((example) => ({ example, doc: example.build() }))
    const featured = all.filter((entry) => entry.example.id === FEATURED)
    return [...featured, ...all.filter((entry) => entry.example.id !== FEATURED)]
  }, [])

  return (
    <ul className="mt-10 grid grid-cols-2 gap-3 sm:mt-12 sm:grid-cols-4 sm:gap-4">
      {entries.map(({ example, doc }) => {
        const big = example.id === FEATURED
        const vertices = doc.vertices.length
        const edges = doc.edges.length
        const blurbId = `home-example-${example.id}`
        return (
          <li key={example.id} className={big ? 'col-span-2 sm:row-span-2' : ''}>
            <button
              type="button"
              onClick={() => openEditor(`example:${example.id}`)}
              // The visible counts are glyphs; the name says them in words.
              aria-label={`${example.name}, ${count(vertices, 'vertex', 'vertices')}, ${count(edges, 'edge', 'edges')}`}
              // The large card shows its blurb; the small ones keep it for a
              // tooltip, which doubles as their accessible description.
              aria-describedby={big ? blurbId : undefined}
              title={big ? undefined : example.blurb}
              className="gz-home-card group"
            >
              {/* The large card's drawing takes up whatever height its two rows
                  give it. A small card's keeps its own, so the rules under the
                  drawings line up across a row even when a name wraps. */}
              <span className={`gz-home-card-art ${big ? 'relative min-h-[13rem] flex-1' : ''}`}>
                <GraphThumbnail
                  doc={doc}
                  width={big ? 420 : 240}
                  height={big ? 300 : 150}
                  padding={big ? 34 : 22}
                  radius={big ? 7 : 5.5}
                  className={big ? 'absolute inset-0 h-full' : ''}
                />
              </span>
              <span className={`flex gap-3 ${big ? 'px-5 pb-5 pt-4' : 'flex-1 px-3.5 pb-3 pt-2.5'}`}>
                <span className="min-w-0 flex-1">
                  <span
                    className={`line-clamp-2 font-medium leading-snug tracking-[-0.01em] ${
                      big ? 'text-[1rem]' : 'text-[0.8125rem]'
                    }`}
                  >
                    {example.name}
                  </span>
                  {big && (
                    <span
                      id={blurbId}
                      className="mt-1 block text-[0.8125rem] leading-relaxed text-pretty text-[var(--gz-muted)]"
                    >
                      {example.blurb}
                    </span>
                  )}
                  <span className="gz-num mt-1 flex items-center gap-2.5 text-[0.6875rem] text-[var(--gz-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <VertexGlyph />
                      {vertices}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <EdgeGlyph />
                      {edges}
                    </span>
                  </span>
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
