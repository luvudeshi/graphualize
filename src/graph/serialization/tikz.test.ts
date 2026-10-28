import { describe, expect, it } from 'vitest'
import { Graph } from '../model/graph'
import { docFromEdges } from '../model/builder'
import { escapeLatex, toTikz, unicodeLabels } from './tikz'

const g = (spec: string[], options?: { directed?: boolean; weighted?: boolean }) =>
  new Graph(docFromEdges(spec, options))

const place = (graph: Graph, positions: [number, number][]): Graph => {
  const doc = graph.toDocument()
  doc.vertices.forEach((vertex, index) => {
    const position = positions[index]
    if (position) {
      vertex.x = position[0]
      vertex.y = position[1]
    }
  })
  return new Graph(doc)
}

const lines = (tex: string, command: string) =>
  tex
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(command))

/**
 * Whether every brace closes, ignoring comments and escaped characters: the
 * check TeX would fail first on a label that was not escaped.
 */
const bracesBalance = (tex: string): boolean => {
  let depth = 0
  for (const line of tex.split('\n')) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '%') break
      if (ch === '{') depth++
      if (ch === '}' && --depth < 0) return false
    }
  }
  return depth === 0
}

const environmentsPair = (tex: string): boolean => {
  const stack: string[] = []
  for (const [, kind, name] of tex.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (kind === 'begin') stack.push(name!)
    else if (stack.pop() !== name) return false
  }
  return stack.length === 0
}

const triangle = () =>
  place(g(['A-B', 'B-C', 'C-A']), [
    [0, 0],
    [100, 0],
    [100, 100],
  ])

describe('TikZ export', () => {
  it('writes one named node per vertex, in centimetres with y pointing up', () => {
    const tikz = toTikz(triangle())
    expect(lines(tikz, '\\node')).toEqual([
      '\\node[vertex] (v1) at (0,2) {A};',
      '\\node[vertex] (v2) at (2,2) {B};',
      '\\node[vertex] (v3) at (2,0) {C};',
    ])
  })

  it('joins edges by node name, straight when nothing runs beside them', () => {
    const tikz = toTikz(triangle())
    expect(lines(tikz, '\\draw')).toEqual([
      '\\draw[edge] (v1) -- (v2);',
      '\\draw[edge] (v2) -- (v3);',
      '\\draw[edge] (v3) -- (v1);',
    ])
  })

  it('puts arrowheads on a digraph only, and names the library they need', () => {
    const directed = toTikz(g(['A->B', 'B->C'], { directed: true }))
    expect(directed).toContain('edge/.style={draw=black!55, line width=1pt, -{Stealth}}')
    expect(directed).toContain('\\usetikzlibrary{arrows.meta}')

    const undirected = toTikz(g(['A-B', 'B-C']))
    expect(undirected).not.toContain('Stealth')
    expect(undirected).not.toContain('arrows.meta')
  })

  it('labels weights in math mode, and only in weighted mode', () => {
    const weighted = toTikz(g(['A-B:7', 'B-C:-3', 'C-A:2.5'], { weighted: true }))
    expect(weighted).toContain('weight/.style={midway')
    expect(weighted).toContain('(v1) -- node[weight] {$7$} (v2);')
    expect(weighted).toContain('node[weight] {$-3$}')
    expect(weighted).toContain('node[weight] {$2.5$}')

    const plain = toTikz(g(['A-B:7']))
    expect(plain).not.toContain('node[weight]')
    expect(plain).not.toContain('weight/.style')
  })

  it('escapes every LaTeX special character in a label', () => {
    expect(escapeLatex('a_b & 50% #1 $x$ {y}')).toBe('a\\_b \\& 50\\% \\#1 \\$x\\$ \\{y\\}')
    expect(escapeLatex('\\ ~ ^ < > |')).toBe(
      '\\textbackslash{} \\textasciitilde{} \\textasciicircum{} \\textless{} \\textgreater{} \\textbar{}',
    )
    // A blank line inside a node would be a paragraph break, which TikZ rejects.
    expect(escapeLatex('two\n\nlines')).toBe('two lines')

    const doc = docFromEdges(['A-B'])
    doc.vertices[0]!.label = 'x_1 {&} 100%'
    const tikz = toTikz(new Graph(doc))
    expect(tikz).toContain('(v1) at (0,0) {x\\_1 \\{\\&\\} 100\\%};')
    expect(bracesBalance(tikz)).toBe(true)
  })

  it('writes Greek letters and primes as math, so they compile under pdfLaTeX', () => {
    expect(escapeLatex('α')).toBe('$\\alpha$')
    expect(escapeLatex('Δx')).toBe('$\\Delta$x')
    expect(escapeLatex('v′ w″')).toBe("v$'$ w$''$")
    // Neighbours share one formula, so the prime sits on the letter; a space
    // between them is kept, since math mode would drop it.
    expect(escapeLatex('αβ′ γ')).toBe("$\\alpha\\beta'$ $\\gamma$")
    // Each to the letter whose glyph it is.
    expect(escapeLatex('ε ϵ φ ϕ')).toBe('$\\varepsilon$ $\\epsilon$ $\\varphi$ $\\phi$')
    // An escaped dollar next to the formula is a control symbol, never `$$`.
    expect(escapeLatex('$α_1')).toBe('\\$$\\alpha$\\_1')

    const graph = g(['α-v′', 'Ω-v″'])
    expect(unicodeLabels(graph)).toEqual({ characters: [], cjk: false })
    const tikz = toTikz(graph, { standalone: true })
    expect(lines(tikz, '\\node').map((line) => line.slice(line.indexOf('{')))).toEqual([
      '{$\\alpha$};',
      "{v$'$};",
      '{$\\Omega$};',
      "{v$''$};",
    ])
    // Nothing is left that needs another engine.
    expect(tikz.split('\n')[0]).toBe('\\documentclass[tikz, border=4pt]{standalone}')
    expect(tikz).not.toContain('LuaLaTeX')
    expect(bracesBalance(tikz)).toBe(true)
  })

  it('points a standalone document whose labels need it at LuaLaTeX', () => {
    const tikz = toTikz(g(['東京-大阪']), { standalone: true, title: 'Rail' })
    const all = tikz.split('\n')
    // The magic comment has to come first for an editor to see it.
    expect(all[0]).toBe('% !TEX program = lualatex')
    expect(all[1]).toBe('% Rail')
    expect(all[2]).toMatch(/^% Some labels .* compile with LuaLaTeX or XeLaTeX .*Overleaf/)
    expect(all[3]).toMatch(/^% The Chinese, Japanese or Korean labels .*\\usepackage\{luatexja\}/)
    expect(all[4]).toBe('\\documentclass[tikz, border=4pt]{standalone}')
    expect(tikz).toContain('{東京};')
    expect(bracesBalance(tikz)).toBe(true)
    expect(environmentsPair(tikz)).toBe(true)
  })

  it('notes in a bare picture that its labels need LuaLaTeX or XeLaTeX', () => {
    const tikz = toTikz(g(['東京-大阪']), { title: 'Rail' })
    const all = tikz.split('\n')
    expect(all.slice(0, 2)).toEqual(['% Rail', '% Needs \\usepackage{tikz} in the preamble.'])
    expect(all[2]).toMatch(/^% Some labels .* compile with LuaLaTeX or XeLaTeX/)
    expect(all[3]).toContain('\\usepackage{luatexja}')
    expect(all[4]).toBe('\\begin{tikzpicture}[')
    // A magic comment only works in the main file, not in a pasted picture.
    expect(tikz).not.toContain('!TEX')
  })

  it('asks for a CJK setup only when a label is Chinese, Japanese or Korean', () => {
    const tikz = toTikz(g(['Москва-Kazan']), { standalone: true })
    expect(tikz.split('\n')[0]).toBe('% !TEX program = lualatex')
    expect(tikz).toContain('compile with LuaLaTeX or XeLaTeX')
    expect(tikz).not.toContain('luatexja')
  })

  it('lists what pdfLaTeX may not typeset, each character once', () => {
    expect(unicodeLabels(g(['東京-α′', 'Ŋ-東', 'ą']))).toEqual({
      characters: ['東', '京', 'Ŋ', 'ą'],
      cjk: true,
    })
    // Omicron and the Greek capitals that look Latin have no LaTeX command.
    expect(unicodeLabels(g(['Ħ-ο', 'Α']))).toEqual({ characters: ['Ħ', 'ο', 'Α'], cjk: false })
    expect(unicodeLabels(g(['서울', 'カナ']))).toMatchObject({ cjk: true })
  })

  it('leaves labels pdfLaTeX typesets, and any title, as they were', () => {
    const graph = g(['Erdős-Rényi', 'Čech-Łoś', 'Kőnig-Gödel', 'x×y-90°'])
    expect(unicodeLabels(graph)).toEqual({ characters: [], cjk: false })
    // The title is only a comment, which TeX skips without reading it.
    const tikz = toTikz(graph, { standalone: true, title: '路線図' })
    expect(tikz.split('\n').slice(0, 2)).toEqual([
      '% 路線図',
      '\\documentclass[tikz, border=4pt]{standalone}',
    ])
    expect(tikz).toContain('{Erdős};')
    expect(tikz).not.toContain('LuaLaTeX')
    expect(toTikz(graph)).not.toContain('LuaLaTeX')
  })

  it('keeps the title inside its comment', () => {
    const tikz = toTikz(g(['A-B']), { title: 'Week 3\n\\end{tikzpicture} 100%' })
    expect(tikz.split('\n')[0]).toBe('% Week 3 \\end{tikzpicture} 100%')
    expect(lines(tikz, '\\end{tikzpicture}')).toHaveLength(1)
  })

  it('wraps a standalone document that compiles as it is', () => {
    const tikz = toTikz(triangle(), { standalone: true })
    const all = tikz.split('\n')
    expect(all[0]).toBe('\\documentclass[tikz, border=4pt]{standalone}')
    expect(all).toContain('\\usetikzlibrary{arrows.meta}')
    expect(all).toContain('\\begin{document}')
    expect(all.at(-1)).toBe('\\end{document}')
    expect(lines(tikz, '\\begin{tikzpicture}')).toHaveLength(1)

    const snippet = toTikz(triangle())
    expect(snippet).not.toContain('\\documentclass')
    expect(snippet).not.toContain('\\begin{document}')
    expect(snippet.split('\n').at(-1)).toBe('\\end{tikzpicture}')
  })

  it('is deterministic, and does not depend on the ids a document happens to use', () => {
    const spec = ['A->B:2', 'B->A:3', 'B-C', 'C-C', 'A->C']
    // Each build draws fresh ids from a global counter.
    const first = g(spec, { directed: true, weighted: true })
    const second = g(spec, { directed: true, weighted: true })
    expect(first.vertices[0]!.id).not.toBe(second.vertices[0]!.id)
    expect(toTikz(first)).toBe(toTikz(second))
    expect(toTikz(first, { standalone: true })).toBe(toTikz(first, { standalone: true }))
  })

  it('spreads parallel edges around the straight line, as the SVG does', () => {
    const graph = place(g(['A-B', 'A-B', 'A-B']), [
      [0, 0],
      [100, 0],
    ])
    // The SVG spaces a bundle 42px apart: atan(2 * 42 / 100) is 40 degrees.
    expect(lines(toTikz(graph), '\\draw')).toEqual([
      '\\draw[edge] (v1) to[bend left=40] (v2);',
      '\\draw[edge] (v1) -- (v2);',
      '\\draw[edge] (v1) to[bend right=40] (v2);',
    ])
  })

  it('bends opposite arcs apart rather than drawing them on top of each other', () => {
    const graph = place(g(['A->B', 'B->A'], { directed: true }), [
      [0, 0],
      [100, 0],
    ])
    // `bend left` is relative to the direction of travel, so the same key on
    // opposite arcs puts them on opposite sides.
    expect(lines(toTikz(graph), '\\draw')).toEqual([
      '\\draw[edge] (v1) to[bend left=23] (v2);',
      '\\draw[edge] (v2) to[bend left=23] (v1);',
    ])
  })

  it('stacks self-loops above the vertex, each one ring further out', () => {
    const draws = lines(toTikz(g(['A-A', 'A-A', 'A-B'])), '\\draw')
    expect(draws).toEqual([
      '\\draw[edge] (v1) to[out=110, in=70, min distance=5.1mm] (v1);',
      '\\draw[edge] (v1) to[out=110, in=70, min distance=8.2mm] (v1);',
      '\\draw[edge] (v1) -- (v2);',
    ])
  })

  it('carries the highlight as one style per role, in the colour it was given', () => {
    const graph = place(g(['A-B', 'B-C', 'C-A', 'C-D']), [
      [0, 0],
      [100, 0],
      [50, 80],
      [150, 80],
    ])
    const [a, b, c] = graph.vertices.map((v) => v.id)
    const cycle = graph.edges.slice(0, 3).map((e) => e.id)
    const tikz = toTikz(graph, {
      highlightVertices: { [a!]: 'cycle', [b!]: 'cycle', [c!]: 'cycle' },
      highlightEdges: Object.fromEntries(cycle.map((id) => [id, 'cycle'])),
      roleColors: { cycle: '#be123c' },
      dimmed: true,
    })
    expect(tikz).toContain('on cycle/.style={draw=gzcycle, line width=1.6pt}')
    expect(tikz).toContain('\\definecolor{gzcycle}{HTML}{BE123C}')
    expect(tikz).toContain('\\node[vertex, on cycle] (v1)')
    expect(tikz).toContain('\\draw[edge, on cycle] (v1) -- (v2);')
    // Everything off the cycle is drawn faintly, as on screen.
    expect(tikz).toContain('dimmed/.style={opacity=0.18}')
    expect(tikz).toContain('\\node[vertex, dimmed] (v4)')
    expect(tikz).toContain('\\draw[edge, dimmed] (v3) -- (v4);')

    const plain = toTikz(graph)
    expect(plain).not.toContain('\\definecolor')
    expect(plain).not.toContain('dimmed')
    expect(plain).not.toContain('on cycle')
  })

  it('names the algorithm roles after what they mean', () => {
    const graph = g(['A-B', 'B-C'])
    const [a, b] = graph.vertices.map((v) => v.id)
    const tikz = toTikz(graph, {
      highlightVertices: { [a!]: 'algorithmVisited', [b!]: 'algorithmCurrent' },
      highlightEdges: { [graph.edges[0]!.id]: 'algorithmAccepted' },
      roleColors: {
        algorithmVisited: '#0f7a58',
        algorithmCurrent: '#4f46e5',
        algorithmAccepted: '#0f7a58',
      },
    })
    expect(tikz).toContain('\\node[vertex, visited] (v1)')
    expect(tikz).toContain('\\node[vertex, current] (v2)')
    expect(tikz).toContain('\\draw[edge, accepted] (v1) -- (v2);')
    expect(tikz).toContain('\\definecolor{gzcurrent}{HTML}{4F46E5}')
  })

  it('fills colour classes, with the role outline on top', () => {
    const graph = g(['A-B', 'B-C'])
    const [a, b, c] = graph.vertices.map((v) => v.id)
    const tikz = toTikz(graph, {
      vertexClasses: { [a!]: 0, [b!]: 1, [c!]: 0 },
      classColors: ['#3b6ef5', '#e8663c'],
      highlightVertices: { [b!]: 'witness' },
      roleColors: { witness: '#b45309' },
    })
    expect(tikz).toContain('class 1/.style={fill=gzclass1, draw=gzclass1, text=white}')
    expect(tikz).toContain('\\definecolor{gzclass1}{HTML}{3B6EF5}')
    expect(tikz).toContain('\\definecolor{gzclass2}{HTML}{E8663C}')
    expect(tikz).toContain('\\node[vertex, class 1] (v1)')
    expect(tikz).toContain('\\node[vertex, class 2, witness] (v2)')
  })

  it('fits a wide drawing to the page without shrinking the vertices', () => {
    const graph = place(g(['A-B']), [
      [0, 0],
      [5000, 0],
    ])
    expect(toTikz(graph)).toContain('\\node[vertex] (v2) at (12,0) {B};')
    expect(toTikz(graph)).toContain('minimum size=6.8mm')
    expect(toTikz(graph, { maxWidth: 30 })).toContain('(v2) at (30,0)')
  })

  it('always produces balanced braces and paired environments', () => {
    const awkward = docFromEdges(['A->B:-1.25', 'B->A', 'B->B', 'A->C:3', 'A->C'], {
      directed: true,
      weighted: true,
    })
    awkward.vertices[0]!.label = '{_}%$#&~^\\'
    awkward.vertices[1]!.label = '}{'
    const cases = [g([]), g(['A']), triangle(), new Graph(awkward)]
    for (const graph of cases) {
      for (const standalone of [false, true]) {
        const tikz = toTikz(graph, { standalone, title: 'Odd {title' })
        expect(bracesBalance(tikz)).toBe(true)
        expect(environmentsPair(tikz)).toBe(true)
      }
    }
  })

  it('draws an empty graph as an empty picture', () => {
    const tikz = toTikz(g([]))
    expect(lines(tikz, '\\node')).toHaveLength(0)
    expect(lines(tikz, '\\draw')).toHaveLength(0)
    expect(tikz).toContain('\\begin{tikzpicture}[')
  })
})
