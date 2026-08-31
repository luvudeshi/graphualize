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

const LIGHT_PALETTE = [
  '#3b6ef5',
  '#e8663c',
  '#12916b',
  '#b455d6',
  '#d0a000',
  '#0c8fb5',
  '#d1417a',
  '#6b7280',
  '#7c8b1f',
  '#8b5e34',
]

const DARK_PALETTE = [
  '#6f9bff',
  '#ff8f63',
  '#2fc79a',
  '#cf87ee',
  '#e8c34a',
  '#4fbede',
  '#ff77a8',
  '#a3adbe',
  '#b6c847',
  '#c48a5c',
]

export const canvasTheme = (dark: boolean): CanvasTheme =>
  dark
    ? {
        dark,
        background: '#101014',
        grid: '#1a1a21',
        vertexFill: '#1e1e26',
        vertexBorder: '#7a7a8c',
        vertexText: '#eceaf2',
        vertexHover: '#2a2a35',
        selected: '#8d88ff',
        selectedFill: '#2a2555',
        edge: '#4d4d5c',
        edgeLabel: '#c8c8d4',
        edgeLabelBg: '#101014',
        dim: '#2a2a33',
        witness: '#fbbf24',
        witnessFill: '#3a2c07',
        path: '#38bdf8',
        cycle: '#fb7185',
        matching: '#a78bfa',
        tree: '#34d399',
        partitionA: '#4fbede',
        partitionB: '#ff8f63',
        current: '#8d88ff',
        visited: '#34d399',
        frontier: '#fbbf24',
        accepted: '#34d399',
        rejected: '#6b6b7a',
        palette: DARK_PALETTE,
        paletteInk: DARK_PALETTE.map(() => '#0b0b0e'),
      }
    : {
        dark,
        background: '#fcfcfb',
        grid: '#eeeeea',
        vertexFill: '#ffffff',
        vertexBorder: '#3f3f46',
        vertexText: '#17171a',
        vertexHover: '#f2f2ef',
        selected: '#4f46e5',
        selectedFill: '#e6e3fd',
        edge: '#9a9aa2',
        edgeLabel: '#4b4b53',
        edgeLabelBg: '#fcfcfb',
        dim: '#dedeD8',
        witness: '#b45309',
        witnessFill: '#fdf0d5',
        path: '#0284c7',
        cycle: '#be123c',
        matching: '#7c3aed',
        tree: '#0f7a58',
        partitionA: '#0c8fb5',
        partitionB: '#e8663c',
        current: '#4f46e5',
        visited: '#0f7a58',
        frontier: '#b45309',
        accepted: '#0f7a58',
        rejected: '#a1a1aa',
        palette: LIGHT_PALETTE,
        paletteInk: LIGHT_PALETTE.map(() => '#ffffff'),
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
