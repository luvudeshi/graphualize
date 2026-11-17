export interface CanvasTheme {
  dark: boolean
  background: string
  grid: string
  vertexFill: string
  /** The lower edge of a vertex's cap: it is shaded like a key, top to bottom. */
  vertexFillLow: string
  vertexBorder: string
  vertexText: string
  vertexHover: string
  selected: string
  selectedFill: string
  edge: string
  edgeLabel: string
  edgeLabelBg: string
  dim: string
  /** Letters of what a witness leaves out: still 4.5:1 on the screen. */
  dimText: string
  witness: string
  witnessFill: string
  path: string
  cycle: string
  matching: string
  tree: string
  partitionA: string
  partitionB: string
  current: string
  visited: string
  frontier: string
  accepted: string
  rejected: string
  /** Qualitative palette used for graph colourings and partitions. */
  palette: string[]
  /** Readable text colour to place on each palette entry. */
  paletteInk: string[]
}

/*
 * The canvas is the instrument's screen: a recessed matte surface with the
 * figure drawn on it in ink and one signal colour. These are the same values
 * as the --gz-screen / --gz-ink / --gz-signal / --gz-cold / --gz-warm tokens
 * in index.css (Cytoscape needs values, not custom properties). Keep them in
 * step.
 *
 * A figure needs more than one ink, so the signal has two companions: hot
 * (the orange), warm (its pale tint) and cold (slate). An algorithm reads as
 * heat: the vertex being visited is hot, the frontier is warm, and what is
 * finished has gone cold.
 */
const DAY = {
  screen: '#f5f3ee',
  cap: '#fbfaf7',
  capLow: '#eceae3',
  ink: '#2a2927',
  signal: '#cf440d',
  cold: '#46505a',
  warm: '#f1b48d',
  /** Letters on the signal, the slate and dark ink: 4.5:1 or better on each. */
  onDark: '#fffdf9',
}

const NIGHT = {
  screen: '#1a1a19',
  cap: '#454340',
  capLow: '#363532',
  ink: '#ece8df',
  signal: '#ff6b2c',
  cold: '#94a0ac',
  warm: '#ffc29e',
  /** Letters on every fill of the night palette, 4.5:1 or better. */
  onLight: '#1b1a18',
}

/*
 * Colourings start with the three figure inks and black, then go on to
 * pigments chosen to sit with them and stay apart from each other: teal,
 * brass, umber, olive, rose and indigo-grey. Each comes with a letter colour
 * that reads on it at 4.5:1 or better.
 */
const DAY_PALETTE: { fill: string; ink: string }[] = [
  { fill: DAY.signal, ink: DAY.onDark },
  { fill: DAY.cold, ink: DAY.onDark },
  { fill: DAY.warm, ink: DAY.ink },
  { fill: DAY.ink, ink: DAY.onDark },
  { fill: '#2f6f62', ink: DAY.onDark }, // teal
  { fill: '#b98a2e', ink: DAY.ink }, // brass
  { fill: '#7b4a2d', ink: DAY.onDark }, // umber
  { fill: '#667434', ink: DAY.onDark }, // olive
  { fill: '#a4505b', ink: DAY.onDark }, // rose
  { fill: '#5b5f8a', ink: DAY.onDark }, // indigo-grey
]

const NIGHT_PALETTE: { fill: string; ink: string }[] = [
  { fill: NIGHT.signal, ink: NIGHT.onLight },
  { fill: NIGHT.cold, ink: NIGHT.onLight },
  { fill: NIGHT.warm, ink: NIGHT.onLight },
  { fill: NIGHT.ink, ink: NIGHT.onLight },
  { fill: '#58b3a0', ink: NIGHT.onLight }, // teal
  { fill: '#d9ae55', ink: NIGHT.onLight }, // brass
  { fill: '#b98a66', ink: NIGHT.onLight }, // umber
  { fill: '#a3b56b', ink: NIGHT.onLight }, // olive
  { fill: '#e2909a', ink: NIGHT.onLight }, // rose
  { fill: '#a79ad0', ink: NIGHT.onLight }, // indigo-grey
]

export const canvasTheme = (dark: boolean): CanvasTheme =>
  dark
    ? {
        dark,
        background: NIGHT.screen,
        grid: '#262625',
        vertexFill: NIGHT.cap,
        vertexFillLow: NIGHT.capLow,
        vertexBorder: NIGHT.ink,
        vertexText: NIGHT.ink,
        vertexHover: '#514f4b',
        selected: NIGHT.signal,
        selectedFill: '#553021',
        edge: NIGHT.ink,
        edgeLabel: NIGHT.ink,
        edgeLabelBg: NIGHT.screen,
        dim: '#7d7a74',
        dimText: '#a09c94',
        witness: NIGHT.signal,
        witnessFill: NIGHT.signal,
        path: NIGHT.signal,
        cycle: NIGHT.signal,
        matching: NIGHT.signal,
        tree: NIGHT.cold,
        partitionA: NIGHT.cold,
        partitionB: NIGHT.signal,
        current: NIGHT.signal,
        visited: NIGHT.cold,
        frontier: NIGHT.warm,
        accepted: NIGHT.cold,
        rejected: NIGHT.ink,
        palette: NIGHT_PALETTE.map((p) => p.fill),
        paletteInk: NIGHT_PALETTE.map((p) => p.ink),
      }
    : {
        dark,
        background: DAY.screen,
        grid: '#e9e6df',
        vertexFill: DAY.cap,
        vertexFillLow: DAY.capLow,
        vertexBorder: DAY.ink,
        vertexText: DAY.ink,
        vertexHover: '#ffffff',
        selected: DAY.signal,
        selectedFill: '#fbe1d3',
        edge: DAY.ink,
        edgeLabel: DAY.ink,
        edgeLabelBg: DAY.screen,
        dim: '#827e76',
        dimText: '#5f5c56',
        witness: DAY.signal,
        witnessFill: DAY.signal,
        path: DAY.signal,
        cycle: DAY.signal,
        matching: DAY.signal,
        tree: DAY.cold,
        partitionA: DAY.cold,
        partitionB: DAY.signal,
        current: DAY.signal,
        visited: DAY.cold,
        frontier: DAY.warm,
        accepted: DAY.cold,
        rejected: DAY.ink,
        palette: DAY_PALETTE.map((p) => p.fill),
        paletteInk: DAY_PALETTE.map((p) => p.ink),
      }

/**
 * The letter colour for a vertex filled with a highlight colour: light on
 * the signal, the slate and black, ink on the pale warm tint.
 */
export const highlightInk = (theme: CanvasTheme, fill: string): string => {
  const at = theme.palette.indexOf(fill)
  if (at >= 0) return theme.paletteInk[at]!
  return theme.dark ? NIGHT.onLight : fill === DAY.warm ? DAY.ink : DAY.onDark
}

export const modeColor = (theme: CanvasTheme, mode: string): string => {
  switch (mode) {
    case 'witness':
      return theme.witness
    case 'path':
      return theme.path
    case 'cycle':
      return theme.cycle
    case 'matching':
      return theme.matching
    case 'tree':
      return theme.tree
    case 'algorithmCurrent':
      return theme.current
    case 'algorithmVisited':
      return theme.visited
    case 'algorithmFrontier':
      return theme.frontier
    case 'algorithmAccepted':
      return theme.accepted
    case 'algorithmRejected':
      return theme.rejected
    default:
      return theme.witness
  }
}
