# Graphualize

**Draw graphs. Understand them.**

Graphualize is a workbench for graph theory. You draw a graph, its properties
update as you type, and clicking any property draws the mathematical reason on
the graph itself: the odd cycle that stops it being bipartite, the two vertices
that realise the diameter, the bridge whose removal disconnects it.

It runs entirely in the browser. No account, no server, no upload, unless you
choose to sign in, and then only the graphs you save go to your account.

It is set like Oliver Byrne's 1847 colour-plate edition of Euclid: cream paper,
black ink and three flat colours, in EB Garamond, with a night edition on deep
indigo for dark mode.

```
Create  →  Inspect  →  Understand  →  Manipulate
```

## Screenshots

The home page. Plate I is the real analysis library running on a real graph,
not a picture of one, with a note on the drawing naming what each property
found:

![The Graphualize home page](docs/screenshot-home.jpg)

The workbench, with the Petersen graph and the live inspector:

![The editor with the Petersen graph and the live inspector](docs/screenshot-editor.jpg)

Clicking **Bipartite: No** draws the odd cycle that proves it and dims
everything else, here in the night edition:

![An odd cycle highlighted on a wheel graph in dark mode](docs/screenshot-witness.jpg)

Dijkstra mid-run, with tentative distances beside the vertices and the
algorithm's own priority queue and finalised set below:

![Dijkstra part-way through a weighted graph](docs/screenshot-dijkstra.jpg)

## Quick start

Two ways in.

**No install.** Build (or download) `Graphualize.html` and double-click it —
one file with the script, the stylesheet and the icon inlined, running straight
from `file://` with no server and no Node. The only things it fetches are the
web fonts (EB Garamond and JetBrains Mono), which are a progressive
enhancement: offline it falls back to a system serif and everything else works
exactly the same.

```bash
npm install && npm run build:single   # produces Graphualize.html
```

Chrome, Edge and Firefox allow local storage on `file://` URLs, so saved graphs
survive a reload there. Safari does not, and Graphualize says so plainly instead
of pretending a save worked — export a file from **File → Export** instead, or
serve the page over `http://` where saving works everywhere.

The home page is at `/`, the workbench at `/#/graph`. Routing is done with the
URL hash rather than paths so that both work identically from a `file://` page
with no server to rewrite URLs. A link like `/#/graph?g=petersen` opens the
workbench with that graph already drawn.

**Development.** Hot reload, tests, the whole toolchain:

```bash
npm install
npm run dev      # http://localhost:5173
```

Requires Node 22.22 or newer (24.15 or newer on Node 24). The dev server and
build alone run on Node 20.19, but the unit tests' jsdom does not.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check the project and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run build:single` | Build `Graphualize.html`, one self-contained file that runs from `file://` |
| `npm test` | Vitest unit and component tests (1,208 tests) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests against a production build (34 tests) |
| `npm run typecheck` | `tsc` over the app, the tests and the e2e suite |
| `npm run lint` | oxlint |
| `npm run verify` | lint, build, unit tests and the auth config check in one go |
| `npm run setup:auth` | Create and configure the Supabase project for Google sign-in |
| `npm run verify:auth` | Check the sign-in configuration and scan for committed secrets |

Running the end-to-end suite for the first time needs a browser:
`npx playwright install chromium`. If your machine already has one, set
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome` instead.

## The idea

Most graph tools answer questions with a boolean. Graphualize answers with
evidence.

```
Bipartite                          No
  B → A → C → B is a cycle of odd length 3,
  and no odd cycle fits in two parts.

Eulerian circuit                   No
  4 vertices have odd degree. An Eulerian trail
  allows at most two.

Diameter                            5
  The furthest pair is A and H. Distances count edges.
```

Every one of those rows is clickable, and clicking it draws the cycle, the
odd-degree vertices, or a realising shortest path on the canvas.

## The home page

`/` is a real front door rather than a splash screen: it explains what the tool
does, then demonstrates it, set as a page from Byrne's Euclid. Plate I, in the
first screen, is live: it runs the same analysis library as the workbench,
cycles through five properties and draws the witness for each one, with an
italic note on the drawing naming it ("the triangle ABC, of odd length", "a
bridge", "cut vertex", a bracket for the diameter). Drag a vertex and the notes
follow it while the mathematics stays put. The tour holds still while you point
at it and has a pause button of its own, and on a phone the demo switches to a
compact drawing of the same graph. A unit test asserts that the demo graph
genuinely has the properties the surrounding copy claims (three bridges, four
articulation vertices, diameter 5, an odd cycle of length 3), so the marketing
cannot drift away from the mathematics.

Plate II shows the worked examples as numbered figures, each drawn with a proper
edge colouring found by an exact search: four inks, and Byrne's dotted black
line as a fifth where four cannot do (K5, the bridges of Königsberg). Tests
check every colouring.

Every route into the product is one click: **Start drawing**, a quick-start that
opens the workbench with `K5`, `C8`, the Petersen graph, `K3,3`, `Q4` or
`G(20,0.2)` already drawn, or any of the figures. If you have a graph in
progress the primary button changes to **Continue "…"** instead of throwing it
away. Signing in is optional, and nothing needs it.

## Getting around

| Key | Action |
|---|---|
| `V` / `N` / `E` / `X` | Select, vertex, edge, erase tools |
| `A` | Place a vertex at the centre of the view |
| `Ctrl/Cmd + K` | Command palette (also accepts `K5`, `C8`, `G(20,0.2)`) |
| `Ctrl/Cmd + S` / `Ctrl/Cmd + Shift + S` | Save / save as |
| `Ctrl/Cmd + O` / `Ctrl/Cmd + N` | Open a saved graph / new graph (most browsers keep `Ctrl/Cmd + N` for a new window; use **File → New graph** there) |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` | Undo / redo |
| `F` | Fit the graph to the screen |
| `Delete` | Delete the selection |
| `Space`, `←`, `→` | Play/pause and step an algorithm |
| `?` | All shortcuts |

Right-click a vertex, an edge or empty canvas for the actions that apply to it —
run BFS from *this* vertex, contract *this* edge, take the induced subgraph of
the selection. Nothing lives only in that menu; it is a shortcut to things the
menu bar and the command palette can also reach.

Double-click a vertex to rename it, or an edge to change its weight. The
inspector's quick-input box takes the same shorthand as the palette:
`K5`, `C8`, `P12`, `K3,4`, `S6`, `W7`, `Q4`, `grid(3,4)`, `G(20,0.2)`,
`tree(12)`, `random(10,3)`, `petersen`. Any of them can end in a weight suffix
that makes the result weighted: `K6 w2-20` for random whole-number weights from
2 to 20, or `grid(4,5) w=len` for weights from the drawn edge lengths.

Both also take edges. `A-B, B-C, C-A`, `A-B B-C`, `a->b->c` (a path) or
`A-B:4` (a weight) adds those edges to the graph on screen as one undo step,
and the status bar says what happened ("Added 3 edges and 1 vertex"); in the
palette the first row previews it before Enter. A graph command always wins,
so `K5` is never read as a vertex. Labels match exactly first, then ignoring
case when only one vertex fits; anything else becomes a new vertex, placed
beside its neighbours or, for a separate piece, in the middle of the view
without landing on the graph. An arrow makes an edgeless graph directed, but
once an undirected graph has edges it is read as a plain edge, so nothing you
already drew changes meaning. A weight turns weights on, and edges that are
already there are skipped and named.

## What it computes

### Overview
Vertices, edges, density, degree sequence, minimum/maximum/average degree,
simplicity (with the offending loops and repeated edges as a witness). Directed
graphs add in- and out-degree sequences, sources and sinks.

### Connectivity
Connected / weakly connected, connected components, bridges, articulation
vertices, strongly connected components, edge connectivity (Stoer–Wagner, or
max-flow for digraphs) and vertex connectivity (max-flow on the split graph).

### Structure
Complete, regular and *k*-regular, tree, forest, bipartite (with the two parts
or an odd cycle), complete bipartite K*m,n*, acyclicity and a topological order
for digraphs, and planarity.

### Cycles
Contains a cycle, girth, Eulerian circuit, Eulerian trail (both with the actual
walk, built by Hierholzer's algorithm) and the odd-degree vertices.

### Distance
All-pairs distances, eccentricity, diameter, radius, centre and periphery, with
weighted and unweighted semantics kept distinct. Negative cycles are reported
rather than silently producing nonsense.

### Colouring, cliques, matching
Greedy colouring under four orderings (document, largest-first, smallest-last
degeneracy, DSATUR), the chromatic number, the exact chromatic polynomial for
small graphs, maximum clique, maximum independent set, a greedy maximal
matching, and the maximum matching — Hopcroft–Karp on bipartite graphs,
Edmonds' blossom algorithm everywhere else.

### Spanning trees and spectrum
Minimum spanning tree or forest (Kruskal), the exact number of spanning trees by
the Matrix–Tree theorem using `bigint` arithmetic, adjacency and Laplacian
eigenvalues, and the algebraic connectivity.

### Matrices
Adjacency, degree, Laplacian, signless Laplacian, incidence and distance
matrices, each with its convention stated, copyable as plain text, CSV or LaTeX.

### Hamiltonicity
Exhaustive Held–Karp search under a stated size limit, plus cheap certificates
(a disconnected graph, or a vertex of degree below 2, is a proof of *no*).

## Algorithms you can step through

BFS, DFS, Dijkstra, Bellman–Ford, Prim, Kruskal, topological sort and greedy
colouring. Each emits a list of complete snapshots rather than animating
anything itself, so stepping backwards is exact and the same graph always
produces the same run.

During playback the canvas distinguishes the current vertex, visited vertices,
the frontier, the active edge, accepted tree edges and rejected edges, and the
panel below shows the algorithm's own state: the BFS queue, the DFS recursion
path, Dijkstra's priority queue and tentative distances, Kruskal's sorted edge
list, Prim's candidate edges, the ready vertices and the output so far for a
topological sort (its remaining indegrees are written on the vertices).

Beside the algorithm's name the player holds the run's own choices: **From**
for the algorithms that start somewhere, **To** for Dijkstra, which then ends on
the shortest path to that vertex, and **Order** for greedy colouring. Changing
one restarts the run from its first step. A vertex you selected before starting
is still where the run begins.

Dijkstra refuses to run on a graph with a negative edge and says to use
Bellman–Ford instead; Bellman–Ford extracts and highlights a negative cycle when
one exists.

## Generators

Path P*n*, cycle C*n*, complete K*n*, complete bipartite K*m,n*, star S*n*,
wheel W*n*, grid, hypercube Q*n*, the Petersen graph, complete trees, and three
random models: Erdős–Rényi G(*n*,*p*), a uniformly random labelled tree via a
Prüfer sequence, and a random *d*-regular graph via the configuration model.
Each press of Generate, or each typed command such as `G(20,0.2)`, draws a new
random graph.

Any generated graph can come with edge weights: **Unit** (every edge 1),
**Random** (whole numbers in a range, 1–9 by default, a new set every time), or
**Length** (the drawn length of each edge, scaled so the median edge weighs 10). Unit weights make Dijkstra, Prim and
Kruskal behave like BFS; the other two give them real choices to make.

## Transformations

Complement, transpose, induced subgraph, delete selected vertices or edges,
contract an edge, subdivide an edge, line graph, graph square, conversion to
the underlying undirected graph, random weights (1–9) for the graph on screen,
and weights from its drawn edge lengths. Each integrates with undo/redo and
reports what it did. Random weights roll a fresh set on every run, and undo and
redo give back exactly the numbers you had.

## Import and export

**Data.** Export to Graphualize JSON, adjacency list, adjacency matrix, CSV edge
list, Graphviz DOT and GraphML. Import detects the format automatically and
accepts Graphualize JSON, DOT, adjacency lists, adjacency matrices and CSV edge
lists. Invalid input produces a sentence explaining the problem, never a stack
trace.

![The export dialog showing a live SVG preview of the Petersen graph with its odd cycle highlighted](docs/screenshot-export.jpg)

**Drawing.** Export the picture as SVG or PNG. The SVG is written from the
document rather than screen-scraped from the canvas, so it is real circles,
lines and text — sharp at any size and editable in Illustrator, Inkscape or
LaTeX. Whatever witness or algorithm step is on screen can travel with it, so
the odd cycle you highlighted is still highlighted in the file you paste into
your write-up. PNG is captured from the canvas at 2× and matches the screen
exactly. The SVG comes as a day or night drawing, in the same inks and Garamond as
the canvas; the PNG keeps the inks on screen and takes only the day or night
paper. Both offer an optional transparent background.

**TikZ.** For write-ups in LaTeX, the same drawing comes out as TikZ source:
one named node per vertex, edges drawn between names (bent apart when they run
in parallel, looped above a vertex for a self-loop), weights as edge labels and
the highlight as one style per role, so restyling the cycle means editing one
line. Copy it into a document, or tick **Standalone document** for a `.tex`
file that compiles as it is on Overleaf.

**Links.** File → Copy share link (also in the command palette) copies a URL
that carries the whole graph — labels, positions, edges, weights and the
directed/weighted flags — in its `#/graph?d=…` fragment, compressed where the
browser can. Nothing is uploaded: the fragment never leaves the browser, so
whoever opens the link gets the graph straight out of the URL, as a new graph
they can undo. Links carry up to 2,000 vertices and 10,000 edges; a graph past
that, or one whose link would be longer than 100,000 characters, is reported
rather than turned into a link that cannot open. Where the clipboard is
unavailable the link is shown, selected, to copy by hand. The single-file build
makes no links: a `file://` address leads nowhere for anyone else, so it says
to export a file instead.

## Saving

File → Save (`Ctrl/Cmd + S`, or the **Save** button in the header) keeps a
graph in the browser's local storage when you are signed out, and in your Google
account when you are signed in. The first save of a graph asks for its name and
says where it will go; after that, Save writes straight away and a note in the
corner says what happened: saved, kept in this browser because the account could
not be reached, or saved as a copy because another tab or device changed it.
A failed save offers **Try again** and **Export instead**. The header button
shows whether there are unsaved changes, and **Save as…** (`Ctrl/Cmd + Shift +
S`) saves under a new name and carries on with the copy.

Nothing is autosaved: the working document is not restored on reload, and the
browser warns before leaving with unsaved changes. **New** and **Open** ask
before they would throw away unsaved work, offering to save it first. Deleting a
saved graph asks for a second click, and can be undone while the Open dialog is
still up. Generating, importing or opening an example puts a *new* graph on
screen rather than editing the saved one, so it takes that name (unless you
chose one) and Save cannot write it over the graph it replaced.

## Signing in (optional)

Graphualize works without an account and always will. Signing in adds one
thing: graphs you save go to your Google account, so they follow you between
devices. Graphs saved in this browser while signed out are copied into the
account the next time you sign in (and an edited one is copied again, onto the
same entry), and the local copies are kept. If the account cannot be reached, a
save falls back to this browser and is copied across once it can. With no
Supabase project configured — which is the default, and the case for the
single-file build — there is no account UI at all, no network request is made,
and saving simply uses this browser.

**If sign-in stops working.** Supabase pauses free-tier projects after a week
without activity. A paused project's hostname stops resolving, so sign-in and
account saves fail while local saving keeps working; pressing sign-in says the
service is unavailable instead of redirecting into an error page. Resume the
project from its Supabase dashboard (data is kept) and everything comes back
without a redeploy. `npm run verify:auth` reports a paused project first.

To stop it happening, `vercel.json` schedules Vercel Cron to call
`/api/keepalive` (`api/keepalive.ts`) twice a day, and each call makes one read
with the publishable key, so the project never sits idle for a week. Crons run on production
deployments only, and the run log is under the project's Settings → Cron Jobs.
The endpoint reads nothing private, but setting a `CRON_SECRET` environment
variable in Vercel restricts it to Vercel Cron.

**Setting it up.** One command does nearly everything that can be scripted:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... npm run setup:auth
```

That creates the Supabase project, waits for it to provision, writes
`.env.local`, and allow-lists the development and preview redirect URLs. It then
prints the one thing that cannot be automated — the exact redirect URI to paste
into Google Cloud Console, because creating an OAuth client requires a Google
login and a consent screen. Paste it, then re-run with the credentials it gives
you back:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... \
GOOGLE_CLIENT_ID=....apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=GOCSPX-... \
npm run setup:auth
```

When you have a production domain, add it with `SITE_URL=https://your-domain`
on the same command.

The script does not create the `graphs` table that account saves go to. Run
`supabase/migrations/0001_graphs.sql` once, in the project's SQL editor or with
`supabase db push`, or signed-in saves fail; `npm run verify:auth` with an
access token checks the table and its row-level security.

**Checking it.** `npm run verify:auth` reports what is actually configured —
whether the Google provider is enabled, what `SITE_URL` is, which redirect URLs
are allow-listed, and whether localhost and production are among them. With
`SUPABASE_ACCESS_TOKEN` set it reads the live project rather than guessing.

**Secrets.** Only two values reach the browser, both publishable by design:
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The Google client secret goes
straight from your shell to Supabase and never touches disk; the service-role
key is never referenced by this codebase at all. `.env*` is gitignored apart
from `.env.example`, and `verify:auth` (and with it `npm run verify`)
fails if a client secret, access token or service-role key ever appears in a
source, config or Markdown file git would commit —
including untracked ones, since that is when a leak is most likely.

## Honesty about what is computed

This is the rule the whole product is built around: **Graphualize never presents
a heuristic as a proof.** Every result that cannot be computed exactly carries a
label saying so, and an explanation of why.

| Computation | Exact up to | Above that |
|---|---|---|
| Chromatic number | 24 vertices | An interval, e.g. `3-5`, with the bounds explained |
| Chromatic polynomial | 12 vertices | Not computed |
| Maximum clique / independent set | 46 vertices | A lower bound with a real witness |
| Hamiltonian cycle | 20 vertices | `Not computed` — never `No` without a proof |
| Maximum matching | 400 vertices | A greedy matching, labelled as a floor |
| Vertex connectivity | 60 vertices | Not computed |
| Edge connectivity | 120 vertices | Not computed |
| Planarity | 150 vertices | Not computed |
| Eigenvalues | 150 vertices | Not computed |
| Spanning tree count | 400 vertices, and about 1 s of estimated work | Not computed |
| All-pairs distances | 400 vertices | Not computed |

Two more points of care:

- **Eigenvalues are floating point.** They are labelled `heuristic`, and
  multiplicities are inferred by grouping values within 1e-7. An eigenvalue that
  looks like −2 is never described as exactly −2. The spanning tree count, in its
  own section beside the spectrum, really is exact: it comes from
  fraction-free Bareiss elimination over `bigint`.
- **"Not computed" is not "no".** Above the limit, Hamiltonicity
  reports `No` only when a cheap certificate proves it — a disconnected graph,
  or a vertex with too few neighbours — and otherwise reports `Not computed`,
  saying in as many words that this is different from a negative answer.

## Architecture in one paragraph

`src/graph/` is a pure TypeScript library with no React and no Cytoscape in it.
It takes a `Graph` and returns data — including, wherever possible, a *witness*:
the cycle, the partition, the path, the matching that justifies the answer. The
UI decides how to draw that. Cytoscape is a view subscribed to the store, never
the source of truth, and every analysis is memoised against a structural hash
that deliberately excludes vertex positions, so dragging a vertex re-runs
nothing. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture.

## Known limitations

- **Planarity** is decided by Euler-bound certificates and Demoucron's path
  addition per biconnected block. It answers yes or no, but does not yet produce
  a Kuratowski subgraph as a witness for "no", or draw a planar embedding.
- **Graph comparison and isomorphism** are not implemented yet.
- **Max-flow / min-cut, Floyd–Warshall and SCC** exist inside the analysis layer
  but are not yet step-through visualisations.
- **Directed spectra.** A directed adjacency matrix can have complex
  eigenvalues, so Graphualize declines rather than showing real parts. Directed
  spanning-tree counting (Tutte's theorem, arborescences) is likewise out of
  scope for now.
- **Expensive computations run on the main thread.** They are size-gated so
  nothing freezes, but a Web Worker would let the limits rise. While an
  expensive analysis is settling, the medium-tier rows briefly show the previous
  graph's numbers — self-consistent, but up to 160 ms behind the canvas.
- **SVG export re-draws the graph** rather than reproducing the canvas
  pixel-for-pixel. Curvature of parallel edges and self-loops is recomputed with
  the exporter's own geometry, so a graph with many parallel edges can bundle
  slightly differently from the screen. PNG is the exact screen; SVG is the
  clean vector version of it.
- **TikZ export is checked, not compiled.** The tests assert on its structure —
  escaped labels, balanced braces, paired environments — but the suite runs no
  LaTeX. Greek letters and primes are written as math, so they compile under
  pdfLaTeX; other labels outside Latin script need LuaLaTeX or XeLaTeX and a
  font that has them, and the export says so in a comment (plus a
  `% !TEX program = lualatex` line in a standalone document).
- **Keyboard editing on the canvas** covers nudging, deleting, placing a vertex
  at the centre of the view (`A`) and every command in the palette, but a vertex
  cannot yet be placed at an arbitrary point without the mouse. Colour is backed
  up by shape for partition and colouring groups and by a legend during
  algorithm playback, but the witness colours themselves (path, cycle, matching,
  tree) are distinguished by colour and the caption in the status bar rather
  than by shape.
- **Mobile** works but is not the target; the canvas is small and there is no
  touch-specific edge gesture.

## Roadmap

The next three things worth building, in order:

1. **Graph comparison mode** — open two graphs side by side, diff their
   invariants, and run a VF2 isomorphism search that returns an explicit vertex
   mapping rather than inferring "isomorphic" from matching invariants.
2. **A Web Worker for the hard invariants** — move exact colouring, maximum
   clique, Hamiltonicity and the connectivity searches off the main thread so
   the size limits can rise substantially and the UI stays responsive while they
   run.
3. **Max-flow / min-cut as a visualisation** — the flow machinery already exists
   for connectivity; exposing it as a step-through algorithm with residual
   capacities on the edges is a natural next lesson.

After those: a Kuratowski-subgraph witness for non-planarity.

## Licence

MIT.
