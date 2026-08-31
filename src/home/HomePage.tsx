import { useEditor } from '../state/store'
import { useTheme } from '../hooks/useTheme'
import { openEditor } from '../app/router'
import { HeroDemo } from './HeroDemo'
import { SavedGraphs } from './SavedGraphs'
import { GraphMarkIcon, MoonIcon, SunIcon } from '../components/Icons'
import { AccountMenu, AuthErrorNotice } from '../auth/AccountMenu'
import { EXAMPLES } from '../graph/examples'

const QUICK_START = ['K5', 'C8', 'Petersen', 'K3,3', 'Q4', 'G(20,0.2)']

const EVIDENCE = [
  {
    property: 'Bipartite',
    verdict: 'No',
    reason: 'B → A → C → B is a cycle of odd length 3, and no odd cycle fits in two parts.',
    shows: 'Highlights that triangle on the graph.',
  },
  {
    property: 'Eulerian circuit',
    verdict: 'No',
    reason: '4 vertices have odd degree. An Eulerian circuit needs every vertex to have even degree.',
    shows: 'Highlights the four odd-degree vertices.',
  },
  {
    property: 'Diameter',
    verdict: '5',
    reason: 'The furthest pair is A and H. Distances count edges.',
    shows: 'Draws a shortest path between them.',
  },
]

const CAPABILITIES: { title: string; items: string[] }[] = [
  {
    title: 'Structure',
    items: [
      'Connected, components, bridges, cut vertices',
      'Strongly connected components, DAG, topological order',
      'Tree, forest, complete, k-regular',
      'Bipartite, with the parts or an odd cycle',
      'Planarity, decided rather than guessed',
    ],
  },
  {
    title: 'Measurement',
    items: [
      'Degree sequences, density, girth',
      'Eccentricity, diameter, radius, centre, periphery',
      'Eulerian circuits and trails, with the walk',
      'Adjacency, Laplacian, incidence and distance matrices',
      'Adjacency and Laplacian spectra, spanning tree counts',
    ],
  },
  {
    title: 'Hard invariants',
    items: [
      'Chromatic number and chromatic polynomial',
      'Maximum clique and independent set',
      'Maximum matching, by blossom or Hopcroft-Karp',
      'Edge and vertex connectivity, with the cut',
      'Hamiltonicity, searched exhaustively or not at all',
    ],
  },
]

const ALGORITHMS = [
  'Breadth-first search',
  'Depth-first search',
  "Dijkstra's algorithm",
  'Bellman-Ford',
  "Prim's algorithm",
  "Kruskal's algorithm",
  'Topological sort',
  'Greedy colouring',
]

const Section = ({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children: React.ReactNode
}) => (
  <section className="border-t py-14 sm:py-20">
    <p className="gz-label mb-2">{label}</p>
    <h2 className="max-w-2xl text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[1.75rem]">
      {title}
    </h2>
    <div className="mt-8">{children}</div>
  </section>
)

export const HomePage = () => {
  const { dark } = useTheme()
  const setTheme = useEditor((s) => s.setTheme)
  const savedName = useEditor((s) => s.name)
  const hasSession = useEditor((s) => s.doc.vertices.length > 0)

  return (
    <div className="min-h-full bg-[var(--gz-bg)] text-[var(--gz-text)]">
      <header className="sticky top-0 z-20 border-b bg-[color-mix(in_oklab,var(--gz-bg)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
          <GraphMarkIcon className="text-[var(--gz-accent)]" />
          <span className="text-[0.9375rem] font-semibold tracking-[-0.015em]">Graphualize</span>
          <span className="hidden text-[0.8125rem] text-[var(--gz-faint)] sm:inline">
            Draw graphs. Understand them.
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="gz-btn px-1.5"
              onClick={() => setTheme(dark ? 'light' : 'dark')}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              type="button"
              className="gz-btn border px-3"
              onClick={() => openEditor()}
            >
              Open the workbench
            </button>
            <AccountMenu compact />
          </div>
        </div>
        <AuthErrorNotice />
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-20">
        {/* Hero */}
        <div className="py-14 sm:py-20">
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[2.75rem]">
            A graph theory workbench that shows its working.
          </h1>
          <p className="mt-5 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--gz-muted)]">
            Draw a graph and its properties update as you edit. Click any property and
            Graphualize draws the reason on the graph itself — the odd cycle that stops it being
            bipartite, the bridge whose removal disconnects it, the pair of vertices that realise
            the diameter.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="gz-btn gz-btn-primary px-4 py-2 text-[0.875rem]"
              onClick={() => openEditor()}
            >
              {hasSession ? `Continue “${savedName}”` : 'Start drawing'}
            </button>
            <button
              type="button"
              className="gz-btn border px-4 py-2 text-[0.875rem]"
              onClick={() => openEditor('Petersen')}
            >
              Open the Petersen graph
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <span className="text-[0.75rem] text-[var(--gz-faint)]">or jump straight to</span>
            {QUICK_START.map((command) => (
              <button
                key={command}
                type="button"
                onClick={() => openEditor(command)}
                className="gz-num rounded-md border px-2 py-1 text-[0.75rem] transition-colors hover:border-[var(--gz-accent)] hover:text-[var(--gz-accent)]"
              >
                {command}
              </button>
            ))}
          </div>

          <SavedGraphs />

          <div className="mt-10">
            <HeroDemo />
          </div>
        </div>

        <Section
          label="The idea"
          title="Most tools answer with a boolean. Graphualize answers with evidence."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {EVIDENCE.map((entry) => (
              <div key={entry.property} className="rounded-xl border p-4">
                <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                  <span className="text-[0.8125rem] text-[var(--gz-muted)]">{entry.property}</span>
                  <span className="gz-num font-medium">{entry.verdict}</span>
                </div>
                <p className="mt-3 text-[0.8125rem] leading-relaxed">{entry.reason}</p>
                <p className="mt-2 text-[0.75rem] text-[var(--gz-faint)]">{entry.shows}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section label="Coverage" title="Everything a discrete maths course actually asks for.">
          <div className="grid gap-8 md:grid-cols-3">
            {CAPABILITIES.map((group) => (
              <div key={group.title}>
                <h3 className="mb-3 text-[0.875rem] font-semibold">{group.title}</h3>
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <li
                      key={item}
                      className="border-l border-[var(--gz-border)] pl-3 text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section
          label="Playback"
          title="Step through an algorithm and watch its own state, not just the graph."
        >
          <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
            <div>
              <ul className="flex flex-wrap gap-1.5">
                {ALGORITHMS.map((name) => (
                  <li
                    key={name}
                    className="rounded-md border px-2.5 py-1 text-[0.8125rem] text-[var(--gz-muted)]"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3 text-[0.875rem] leading-relaxed text-[var(--gz-muted)]">
              <p>
                Every run is a list of complete snapshots, so stepping backwards is exact and
                scrubbing the timeline lands precisely where you expect. The panel shows what the
                algorithm is actually holding: the BFS queue, the DFS recursion path, Dijkstra's
                priority queue and tentative distances, Kruskal's sorted edges as they are accepted
                or rejected.
              </p>
              <p>
                Dijkstra refuses to run on a graph with a negative edge, says so, and tells you to
                use Bellman-Ford — which then finds the negative cycle and draws it.
              </p>
            </div>
          </div>
        </Section>

        <Section label="Honesty" title="It tells you what it does not know.">
          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr]">
            <div className="space-y-3 text-[0.875rem] leading-relaxed text-[var(--gz-muted)]">
              <p>
                Several of these invariants are NP-hard. Graphualize computes them exactly under a
                stated size limit and, past it, reports honest bounds with the reason — never a
                heuristic dressed up as a proof.
              </p>
              <p>
                Eigenvalues are labelled as the floating-point approximations they are. A
                Hamiltonian search that was not exhaustive says <em>not computed</em>, which is not
                the same as <em>no</em>.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.8125rem] text-[var(--gz-muted)]">Chromatic number</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="gz-chip">bounded</span>
                  <span className="gz-num font-medium">3–5</span>
                </span>
              </div>
              <p className="mt-3 border-l-2 border-[var(--gz-accent)] bg-[color-mix(in_oklab,var(--gz-accent-soft)_70%,transparent)] px-2.5 py-1.5 text-[0.75rem] leading-relaxed">
                Exact computation is disabled above 24 vertices. Greedy found a 5-colouring, and the
                graph contains a triangle, so the chromatic number is between 3 and 5.
              </p>
            </div>
          </div>
        </Section>

        <Section label="Examples" title="Start from something worth looking at.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() => openEditor(`example:${example.id}`)}
                className="rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--gz-accent)] hover:bg-[var(--gz-accent-soft)]"
              >
                <span className="block text-[0.8125rem] font-medium">{example.name}</span>
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--gz-muted)]">
                  {example.blurb}
                </span>
              </button>
            ))}
          </div>
        </Section>

      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-5 text-[0.75rem] text-[var(--gz-faint)]">
          <GraphMarkIcon width={14} height={14} />
          <span>Graphualize</span>
          <span>Draw graphs. Understand them.</span>
          <span className="ml-auto">Built with React, TypeScript and Cytoscape.js.</span>
        </div>
      </footer>
    </div>
  )
}
