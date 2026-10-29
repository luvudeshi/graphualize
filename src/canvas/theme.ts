export interface CanvasTheme {
  dark: boolean
  background: string
  grid: string
  vertexFill: string
  vertexBorder: string
  vertexText: string
  vertexHover: string
  selected: string
  selectedFill: string
  edge: string
  edgeLabel: string
  edgeLabelBg: string
  dim: string
  /** Letters of what a witness leaves out: still 4.5:1 on the paper. */
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
 * The canvas is a plate from Byrne's 1847 Euclid, like the home page's: warm
 * paper, black ink and three flat primaries. These are the same inks as the
 * --gz-paper / --gz-ink / --gz-red / --gz-blue / --gz-yellow tokens in
 * index.css (Cytoscape needs values, not custom properties). Keep them in
 * step.
 */
const DAY = {
  paper: '#f8f2e1',
  paperDeep: '#ebdfc1',
  ink: '#1d1a14',
  red: '#c9381d',
  blue: '#24519f',
  yellow: '#e6a915',
  /** Letters on vermilion, cobalt and dark ink: 4.5:1 or better on each. */
  onDark: '#f8f1de',
}

/* The night edition: cream ink and the primaries lifted for the indigo board. */
const NIGHT = {
  paper: '#1f2347',
  paperDeep: '#2a2f5c',
  ink: '#ece2c6',
  red: '#f2694a',
  blue: '#4f7fee',
  blueLine: '#6f9af0',
  yellow: '#f3be33',
  /** Letters on every fill of the night palette, 4.5:1 or better. */
  onLight: '#0f1129',
}

/*
 * Colourings use Byrne's inks first (vermilion, cobalt, chrome yellow, black)
 * and then printed pigments that sit with them: verdigris, rose madder, burnt
 * umber, slate, ochre and violet-grey. Each comes with a letter colour that
 * reads on it at 4.5:1 or better.
 */
const DAY_PALETTE: { fill: string; ink: string }[] = [
  { fill: DAY.red, ink: DAY.onDark },
  { fill: DAY.blue, ink: DAY.onDark },
  { fill: DAY.yellow, ink: DAY.ink },
  { fill: DAY.ink, ink: DAY.onDark },
  { fill: '#276b5d', ink: DAY.onDark }, // verdigris
  { fill: '#d27a8a', ink: DAY.ink }, // rose madder
  { fill: '#7a5230', ink: DAY.onDark }, // umber
  { fill: '#5d6b78', ink: DAY.onDark }, // slate
  { fill: '#c29a55', ink: DAY.ink }, // ochre
  { fill: '#6a5f85', ink: DAY.onDark }, // violet-grey
]

const NIGHT_PALETTE: { fill: string; ink: string }[] = [
  { fill: NIGHT.red, ink: NIGHT.onLight },
  { fill: NIGHT.blue, ink: NIGHT.onLight },
  { fill: NIGHT.yellow, ink: NIGHT.onLight },
  { fill: NIGHT.ink, ink: NIGHT.onLight },
  { fill: '#4fae96', ink: NIGHT.onLight }, // verdigris
  { fill: '#e48a9a', ink: NIGHT.onLight }, // rose madder
  { fill: '#b98552', ink: NIGHT.onLight }, // umber
  { fill: '#93a3b3', ink: NIGHT.onLight }, // slate
  { fill: '#d9b56e', ink: NIGHT.onLight }, // ochre
  { fill: '#a597c4', ink: NIGHT.onLight }, // violet-grey
]

export const canvasTheme = (dark: boolean): CanvasTheme =>
  dark
    ? {
        dark,
        background: NIGHT.paper,
        grid: '#262a52',
        vertexFill: NIGHT.paper,
        vertexBorder: NIGHT.ink,
        vertexText: NIGHT.ink,
        vertexHover: NIGHT.paperDeep,
        selected: NIGHT.blueLine,
        selectedFill: '#27306a',
        edge: NIGHT.ink,
        edgeLabel: NIGHT.ink,
        edgeLabelBg: NIGHT.paper,
        dim: '#7b82a4',
        dimText: '#a3a9c6',
        witness: NIGHT.red,
        witnessFill: NIGHT.red,
        path: NIGHT.red,
        cycle: NIGHT.red,
        matching: NIGHT.red,
        tree: NIGHT.blue,
        partitionA: NIGHT.blue,
        partitionB: NIGHT.red,
        current: NIGHT.red,
        visited: NIGHT.blue,
        frontier: NIGHT.yellow,
        accepted: NIGHT.blueLine,
        rejected: NIGHT.ink,
        palette: NIGHT_PALETTE.map((p) => p.fill),
        paletteInk: NIGHT_PALETTE.map((p) => p.ink),
      }
    : {
        dark,
        background: DAY.paper,
        grid: '#efe6cf',
        vertexFill: DAY.paper,
        vertexBorder: DAY.ink,
        vertexText: DAY.ink,
        vertexHover: DAY.paperDeep,
        selected: DAY.blue,
        // A pale cobalt that still reads blue on the cream paper (a token mix
        // of cobalt into warm paper cancels to grey and looks disabled).
        selectedFill: '#dbe3f3',
        edge: DAY.ink,
        edgeLabel: DAY.ink,
        edgeLabelBg: DAY.paper,
        dim: '#857b6a',
        dimText: '#5f5544',
        witness: DAY.red,
        witnessFill: DAY.red,
        path: DAY.red,
        cycle: DAY.red,
        matching: DAY.red,
        tree: DAY.blue,
        partitionA: DAY.blue,
        partitionB: DAY.red,
        current: DAY.red,
        visited: DAY.blue,
        frontier: DAY.yellow,
        accepted: DAY.blue,
        rejected: DAY.ink,
        palette: DAY_PALETTE.map((p) => p.fill),
        paletteInk: DAY_PALETTE.map((p) => p.ink),
      }

/**
 * The letter colour for a vertex filled with a highlight colour: paper on
 * vermilion, cobalt and black, ink on chrome yellow.
 */
export const highlightInk = (theme: CanvasTheme, fill: string): string => {
  const at = theme.palette.indexOf(fill)
  if (at >= 0) return theme.paletteInk[at]!
  return theme.dark ? NIGHT.onLight : fill === DAY.yellow ? DAY.ink : DAY.onDark
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
