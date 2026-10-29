import { useId, useMemo } from 'react'
import type { GraphDocument } from '../graph/model/types'
import { thumbnailGeometry, type ThumbnailOptions } from './thumbnail'
import { EDGE_INKS, edgeInks } from './byrne'

/**
 * A small, static drawing of a document, styled entirely from CSS (see
 * `.gz-thumb-*` in home.css) so it follows the theme without knowing about it.
 * Each edge carries one of the page's edge inks (`data-ink`), handed out as a
 * proper edge colouring: no two edges meeting at a vertex share one, as in
 * Byrne's plates. Decorative: the card around it carries the name.
 */
export const GraphThumbnail = ({
  doc,
  width = 240,
  height = 150,
  padding = 20,
  radius = 5.5,
  className = '',
}: {
  doc: GraphDocument
  className?: string
} & Partial<ThumbnailOptions>) => {
  const marker = `gz-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const geometry = useMemo(
    () => thumbnailGeometry(doc, { width, height, padding, radius }),
    [doc, width, height, padding, radius],
  )
  const inks = useMemo(() => edgeInks(doc), [doc])

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`gz-thumb ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {doc.directed && (
        <defs>
          {/* One arrowhead per ink, so each matches the edge it ends. */}
          {EDGE_INKS.map((ink, k) => (
            <marker
              key={ink}
              id={`${marker}-${k}`}
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="3.2"
              markerHeight="3.2"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" className="gz-thumb-arrow" data-ink={k} />
            </marker>
          ))}
        </defs>
      )}
      <g>
        {geometry.edges.map((edge) => {
          const ink = inks.get(edge.id) ?? 0
          return (
            <path
              key={edge.id}
              d={edge.d}
              className="gz-thumb-edge"
              data-ink={ink}
              markerEnd={doc.directed ? `url(#${marker}-${ink})` : undefined}
            />
          )
        })}
      </g>
      <g>
        {geometry.vertices.map((vertex) => (
          <circle
            key={vertex.id}
            cx={vertex.x}
            cy={vertex.y}
            r={radius}
            className="gz-thumb-vertex"
          />
        ))}
      </g>
    </svg>
  )
}
