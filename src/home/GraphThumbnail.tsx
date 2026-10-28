import { useId, useMemo } from 'react'
import type { GraphDocument } from '../graph/model/types'
import { thumbnailGeometry, type ThumbnailOptions } from './thumbnail'

/**
 * A small, static drawing of a document, styled entirely from CSS (see
 * `.gz-thumb-*` in home.css) so it follows the theme without knowing about it.
 * Decorative: the card around it carries the name.
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

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`gz-thumb ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {doc.directed && (
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="8.5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" className="gz-thumb-arrow" />
          </marker>
        </defs>
      )}
      <g>
        {geometry.edges.map((edge) => (
          <path
            key={edge.id}
            d={edge.d}
            className="gz-thumb-edge"
            markerEnd={doc.directed ? `url(#${marker})` : undefined}
          />
        ))}
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
