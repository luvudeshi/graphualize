import type { CSSProperties } from 'react'
import { FRONTISPIECE_EDGES, FRONTISPIECE_FACES, FRONTISPIECE_POINTS } from './euclid47'

/**
 * The quick-start display's idle figure: Euclid I.47 drawn as a plane graph,
 * its faces laid in four inks with no two neighbours alike (see euclid47.ts).
 * The drawing is decorative, so hidden from assistive technology; the display
 * (QuickUnit) prints what it is beneath it.
 */

const SCALE = 40
const PAD = 22
const at = (id: string): readonly [number, number] => {
  const [x, y] = FRONTISPIECE_POINTS[id]!
  return [(x + 2.4) * SCALE + PAD, (5.6 - y) * SCALE + PAD]
}
const WIDTH = 9.8 * SCALE + 2 * PAD
const HEIGHT = 10.6 * SCALE + 2 * PAD

const polygon = (ids: string) =>
  ids
    .split('')
    .map((id) => at(id).join(','))
    .join(' ')

const order = (i: number) => ({ '--gz-i': i }) as CSSProperties

export const Frontispiece = () => {
  const [cx, cy] = at('C')
  const foot = at('E')[1]
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="gz-home-frontis-svg"
      aria-hidden="true"
      focusable="false"
    >
      {FRONTISPIECE_FACES.map(({ ids, ink }, i) => (
        <polygon
          key={ids}
          points={polygon(ids)}
          className="gz-home-face"
          data-ink={ink}
          style={order(i)}
        />
      ))}
      {/* Euclid's construction line, dropped from the right angle. */}
      <line x1={cx} y1={cy} x2={cx} y2={foot} className="gz-home-construct" />
      {FRONTISPIECE_EDGES.map((pair) => {
        const [x1, y1] = at(pair[0]!)
        const [x2, y2] = at(pair[1]!)
        return <line key={pair} x1={x1} y1={y1} x2={x2} y2={y2} className="gz-home-frontis-edge" />
      })}
      {Object.keys(FRONTISPIECE_POINTS).map((id) => {
        const [x, y] = at(id)
        return <circle key={id} cx={x} cy={y} r={7.5} className="gz-home-frontis-vertex" />
      })}
    </svg>
  )
}
