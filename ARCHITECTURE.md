# Architecture

## The one rule

`src/graph/` is a pure TypeScript library. It imports no React, no Cytoscape, no
DOM. It takes a `Graph` and returns data. Everything else in the app is a view
of that data.

This is what makes the product work: because analysis returns a *witness* rather
than a boolean, the UI can draw the reason for an answer without the analysis
knowing anything about drawing.

## Layout

```
src/
  graph/                 the library — no React, no Cytoscape
    model/               Graph, GraphDocument, ids, builder, witness types
    properties/          the mathematics, one concern per file
    algorithms/          step emitters for the visualiser
    generators/          named families and random models
    transformations/     complement, line graph, contraction, ...
    serialization/       versioned JSON plus DOT/CSV/matrix/GraphML, and SVG/TikZ out
    analysis.ts          assembles PropertyResults into inspector sections
    layout.ts            position generators (circle, grid, BFS, force, ...)
    cache.ts             LRU memoisation keyed on a graph's structure
    examples.ts          the built-in gallery
  app/                   the hash router
  auth/                  optional Google sign-in — nothing else depends on it
  home/                  the landing page and its live demo
  state/                 Zustand store, local documents, high-level actions
  canvas/                the only place Cytoscape exists
  components/            shell, inspector, player, palette, dialogs
  hooks/                 theme, debounce, global shortcuts
  utils/                 fuzzy matching, platform helpers
e2e/                     Playwright flows
```

## Data model

```ts
interface Vertex { id: VertexId; label: string; x: number; y: number }
interface Edge   { id: EdgeId; source: VertexId; target: VertexId; weight?: number }
interface GraphDocument {
  vertices: Vertex[]; edges: Edge[]; directed: boolean; weighted: boolean
}
```

`GraphDocument` is the serialisable truth. `Graph` wraps one in an immutable,
indexed view built in O(V+E): adjacency in both orientations, incidence lists,
degree tables, a pair index for edge lookup, and a stable vertex order for
matrix rows. Analyses never mutate it; the store constructs a new `Graph`
whenever the document changes.

Self-loops and parallel edges are supported throughout. A self-loop contributes
2 to undirected degree and 1 to both in- and out-degree, and the code paths that
care (bridges, girth, matching, planarity, spanning trees) each state their
convention in a doc comment.

## Why dragging a vertex is free

`Graph.structureKey()` produces a string that changes exactly when the
mathematics changes: the sorted vertex ids, the sorted normalised edges with
weights, and the directed/weighted flags. Positions are deliberately excluded.
`Graph.displayKey()` adds the labels, and is what the inspector uses, because
its prose quotes them ("B → A → C → B is a cycle of odd length 3").

The ids themselves are in the key, not just how many there are: witnesses name
ids, so two structurally identical graphs on different vertices must never share
a cache entry — that would highlight vertices that no longer exist.

Every analysis is memoised on that key by `memoByStructure` in
`graph/cache.ts` — a module-level LRU, not a component hook, so undo, redo,
reopening a panel and switching documents all hit a warm cache. The medium and
hard tiers are keyed on a *debounced graph*, and the same graph object is both
the key and the input, so a result can never be filed under another graph's key.

The result: moving a vertex re-renders the canvas and nothing else.

## Cost tiers

The inspector splits work into three tiers, and the store and components respect
the split.

| Tier | Runs | Contains |
|---|---|---|
| **Core** | Synchronously on every structural change | Counts, density, degrees, components, bridges, articulation points, SCCs, tree/forest, bipartite, complete, regular, DAG + topological order, cycles, girth, Eulerian, planarity |
| **Metrics** | Debounced 160 ms | All-pairs distances, greedy colouring, matching, MST, spanning tree count, spectrum, matrices |
| **Hard** | Only when the section is expanded | Chromatic number and polynomial, maximum clique, maximum independent set, Hamiltonicity, edge and vertex connectivity |

Everything in the hard tier is NP-hard or cubic-with-a-big-constant. Each module
owns its own size limit and step budget, and reports honestly when it hits one
(see the table in the README). The next step for these is a Web Worker; the
interfaces are already worker-shaped, since every entry point is a pure function
from `Graph` to `PropertyResult`.

## Witnesses

```ts
type GraphWitness =
  | { type: 'vertices';  vertexIds: VertexId[] }
  | { type: 'edges';     edgeIds: EdgeId[] }
  | { type: 'path';      vertexIds: VertexId[]; edgeIds: EdgeId[] }
  | { type: 'cycle';     vertexIds: VertexId[]; edgeIds: EdgeId[] }
  | { type: 'trail';     vertexIds: VertexId[]; edgeIds: EdgeId[] }
  | { type: 'matching';  edgeIds: EdgeId[] }
  | { type: 'partition'; groups: VertexId[][] }
  | { type: 'coloring';  colors: Record<VertexId, number>; count: number }
  | { type: 'tree';      edgeIds: EdgeId[] }
```

`analyzeBipartite` returns partitions *or* an odd cycle. `analyzeEulerian`
returns a Hierholzer walk *or* the odd-degree vertices. `analyzeDistances`
returns the pair realising the diameter, and the inspector asks for a shortest
path between them. `chromaticNumber` returns the best colouring it found, along
with the bounds and whether they were proved.

For a cycle witness the ordering is a contract: `edgeIds[i]` joins
`vertexIds[i]` to `vertexIds[i+1 mod n]`. The test suite checks this against the
graph rather than trusting it.

## Highlighting

There is exactly one path from a witness to pixels:

```
witness ──witnessToHighlight()──▶ HighlightRequest ──▶ GraphCanvas effect
step    ──stepToHighlight()─────▶
```

`HighlightRequest` is `{ vertices, edges, colors, badges, dimOthers, caption }`,
where each vertex and edge maps to a semantic mode (`witness`, `path`, `cycle`,
`matching`, `tree`, `algorithmCurrent`, `algorithmVisited`, `algorithmFrontier`,
`algorithmAccepted`, `algorithmRejected`). The canvas resolves modes to colours
from the current theme and writes them as element *data*, so the Cytoscape
stylesheet stays declarative and no component ever touches Cytoscape styling.

Only one witness is active at a time; starting an algorithm clears it, and
clicking an active row toggles it off.

## Algorithms

```ts
interface AlgorithmStep {
  type: string; description: string; detail?: string
  activeVertices?, visitedVertices?, frontierVertices?: VertexId[]
  activeEdges?, treeEdges?, rejectedEdges?: EdgeId[]
  state?: Record<string, string>      // "Queue", "Priority queue", "Output"
  badges?: Record<VertexId, string>   // distances, indegrees, discovery order
  colors?: Record<VertexId, number>
}
```

Every step is a **complete snapshot**, never a delta. Stepping backwards is
therefore a pure re-render, scrubbing the slider is exact, and the player holds
no algorithm state of its own. Steps are deep-copied on emit, so no two frames
share a mutable array — there is a test that mutates step 0 and asserts step 1
is unaffected.

Algorithms are deterministic: ties break on document order, and nothing calls
`Math.random`. A `precondition(graph, options)` returns either `null` or the
sentence the status bar should show — that is how Dijkstra refuses a negative
weight and names Bellman–Ford.

## State

One Zustand store (`state/store.ts`) holds the document, selection, tool,
history, active witness, algorithm session and UI flags. A second tiny store
(`state/ui.ts`) holds which dialog is open, purely to avoid prop drilling.

Undo/redo snapshots the whole `GraphDocument` on each committed mutation. For
the graph sizes this tool targets that is cheaper and far more reliable than an
inverse-operation log, and it means a generator, an import and a transformation
are each a single undo step. Drags commit once on release, not per frame, and
repeated arrow-key nudges coalesce into one entry.

`commit()` compares the structure key before and after. When the structure
changed it drops the active witness and any running algorithm, because both
describe a graph that no longer exists — this is what stops the inspector
reading "Bridges 0" while two edges are still drawn as bridges.

Vertex and edge ids are only unique within one run of the module, so anything
arriving from outside — a restored session, an opened document, an import —
goes through `absorbIds()` first, which advances the counter past every id it
carries. Without that, a page reload silently reissues ids and two vertices
collapse into one.

`replaceDocument` is the single entry point for anything that swaps the whole
graph (generators, transformations, imports, examples); it clears the selection,
stops any running algorithm and asks the canvas to fit.

It also distinguishes an *edit* from a *replacement*. A transformation is an
edit: the complement of your graph is still your graph. A generator, an import
or an example is a replacement, and passes a `title`. A replacement takes that
title as the document name unless the user has chosen one (`namedByUser`, which
is persisted with the session so a reload cannot lose the distinction), and
detaches from the saved entry it displaced — otherwise generating `K5` on top of
an open "Homework 3" and pressing Save would overwrite the homework with `K5`,
with nothing to undo it.

## Routing

`app/router.ts` is thirty lines of hash routing: `#/` is the home page, `#/graph`
the workbench, and `#/graph?g=petersen` the workbench with that command already
run. Hashes rather than paths because the product also ships as a single
`file://` HTML with no server to rewrite URLs — a `BrowserRouter` would 404 the
moment someone reloaded on `/graph`, and would not work at all from a file.

The arrival command is consumed exactly once (a ref guards against React's
double-invoked effects in development) and then erased from the URL with
`history.replaceState`, so a reload does not silently regenerate the graph over
whatever the user has since drawn.

The two routes want different scroll behaviour: the workbench is a fixed
viewport with its own scrolling panels, the home page is a document. `App` sets
`document.documentElement.dataset.route`, and three CSS rules relax the
`height: 100%` chain for `data-route="home"`. Doing it on the root element
rather than with an inner scroll container is what makes browser find-in-page,
`scrollIntoView` and full-page screenshots behave normally.

## The home page

`home/HomePage.tsx` is a marketing page that markets by demonstrating.
`home/HeroDemo.tsx` mounts a small Cytoscape instance and runs the *real*
`analyzeCore` / `analyzeMetrics` over a hand-laid eight-vertex graph, stepping
through five properties and drawing each witness with the same
`witnessToHighlight` pipeline the workbench uses. It pauses on hover and focus,
respects `prefers-reduced-motion`, and leaves the vertices draggable.

Because the demo runs the real library, the copy around it can go stale in a way
a screenshot cannot. `home/home.test.tsx` therefore asserts that the demo graph
genuinely has the properties the page claims — three bridges, four articulation
vertices, diameter 5, an odd cycle of length 3 — and that every row the tour
names actually exists and carries a witness. Change the demo graph and the
prose, or the test, will tell you.

## Canvas

`canvas/GraphCanvas.tsx` owns the only Cytoscape instance. It:

- diffs `doc` against the current elements rather than rebuilding them, so
  identity, selection and animation survive edits;
- animates position changes only when they came from the store (a layout, an
  undo), never while the user is dragging;
- keeps selection in sync in both directions behind a re-entrancy guard;
- rebuilds the stylesheet when the theme or the directed/weighted flags change;
- draws badges and the edge-drawing rubber band in an HTML overlay positioned
  from the viewport transform, because Cytoscape has no second label per node;
- turns `cxttap` on a node, an edge or the background into a `ContextMenu`,
  using the original mouse event for screen coordinates and Cytoscape's model
  position for "add a vertex *here*". Every item in that menu also exists in the
  menu bar or the command palette — a right-click is a shortcut, never the only
  route to something.

The one Cytoscape-specific wart worth knowing: it forces `position: relative`
onto its container, so the container is sized with percentages rather than
`inset-0`, and a `ResizeObserver` calls `cy.resize()` when panels open or close.

## Authentication

`src/auth/` is a leaf. Nothing in `src/graph/`, `src/state/` or `src/canvas/`
imports it; `App` calls `initialize()` once and the two headers render an
`<AccountMenu />`. Delete the directory and the product still compiles and
works. That is the shape the requirement "keep anonymous usage working"
demands — not a flag checked in a hundred places, but a layer with no inbound
edges.

`isAuthConfigured()` is the single gate, and it is false unless there is a
project URL, a publishable key, *and* an http(s) origin. So the test runner, a
checkout with no `.env.local`, and the single-file `file://` build all take the
same path: `status: 'unconfigured'`, no account UI, no network call. The
single-file build goes further and aliases `@supabase/supabase-js` to a
throwing stub, because ~210 KB of SDK that cannot run is 210 KB too many in a
file meant to be emailed.

Three details are load-bearing:

- **PKCE, not the implicit flow.** The implicit flow returns its tokens in the
  URL *fragment*, and Graphualize routes on the fragment. Those two uses of the
  hash cannot coexist — the router would see `#access_token=...` as a route.
  PKCE returns `?code=` in the query string, which nothing else here reads.
- **`redirectTo` is the bare origin + path.** It has to be allow-listed by
  Supabase, and a URL carrying a route is a poor allow-list entry. The route is
  parked in `sessionStorage` instead and restored on return — per-tab and
  self-cleaning, so an abandoned redirect cannot strand a stale route.
- **Sign-out is unconditional.** supabase-js clears the stored session before it
  calls the server, so a failed network call still means the user is signed out
  on this device. Reporting an error there would describe a state that no longer
  exists.

The test suite pins `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to empty
in `vitest.config.ts`. Vite loads `.env.local` into test runs, so without that
pin a developer with Supabase configured locally runs a different suite from CI
— different branches taken, and any test reaching `initialize()` opening a live
client against a real project. The configured paths are tested by mocking
`auth/client` instead, and a test asserts the pin is still in place.

Signing out never touches `graphualize:*` storage. The session lives under its
own `graphualize:auth:v1` key precisely so that the two can never collide, and a
test asserts that saved graphs survive a sign-out — a promise of "anonymous
usage keeps working" is worthless if signing out takes the user's work with it.

### Where a save goes

Signed out, `saveCurrent` writes to local storage (`state/documents.ts`).
Signed in, it writes to the `graphs` table (`sync/cloud.ts`) with an optimistic
`version` check: a stale write is saved as a separate copy, never over the newer
row. `savedWhere` and `documentsSource` record which of the two the open graph
and the listed graphs belong to, so opening or deleting goes back to the same
place.

`sync/adopt.ts` carries local graphs into the account on sign-in. It keeps one
link per local graph — `{cloudId, version, updatedAt}` under
`graphualize:adopted:v2` — with one invariant: the local copy *as of
`updatedAt`* is the content of `cloudId` at `version`. A newer local save means
"upload again, expecting `version`", so an edit made signed out lands on the
same row, and if that row moved on elsewhere the version check keeps both.
Every writer preserves the invariant: a signed-in save of a local graph rewrites
the local copy to match, an offline fallback links with `updatedAt: 0` to the
version it was based on, and deleting a row in the account unlinks the local
copies that pointed at it. Uploads run one at a time across tabs (Web Locks)
because Supabase announces a sign-in to every open tab.

When the account cannot be reached — `cloud.ts` reports `unreachable` for a
failed fetch and for gateway, Cloudflare 52x and Supabase's paused-project 540
statuses — a save falls back to local storage and the list shows this browser's
graphs; the next call that gets through copies them across. Before redirecting
to Google, `signInWithGoogle` makes a `no-cors` request to the project, which
rejects only when nothing answers (a paused project stops resolving in DNS), and
says so instead of navigating into a browser error page.

## Exporting the drawing

There are two kinds of exporter and they are deliberately different things.

`graph/serialization/svg.ts` is part of the pure library: it takes a `Graph` and
returns an SVG string, with no Cytoscape and no DOM anywhere in it. It does its
own geometry — quadratic Béziers for bundles of parallel edges, teardrops for
self-loops, a sampled intersection so a stroke stops at the vertex rim rather
than under it, arrowheads placed along the tangent — and escapes every piece of
user text. That is why the output is editable in Illustrator or Inkscape and why
it is unit-testable: the tests parse it with `DOMParser` and assert on the
resulting document rather than on a string.

`graph/serialization/tikz.ts` is a second backend on the same geometry: the
same bundles and spacing, turned into `bend left`/`bend right` angles, and the
same stacked loops — except that it measures a bend's side against the bundle's
first edge, so arcs u→v and v→u separate. Vertices become nodes named by their
order and edges are drawn between names, so TikZ clips each line at the node
rim itself. Its styles live in the picture's own options rather than a global
`\tikzset`, and a highlight arrives as roles, each one style with its colour.

`state/drawing.ts` is the impure half. It reads the on-screen witness or
algorithm step, maps each element's semantic mode through the same
`modeColor`/`canvasTheme` tables the canvas uses, and hands the result to the SVG
exporter as plain colours, or to the TikZ exporter as roles plus the light
theme's colour for each — so the highlight in the file is the highlight on the
screen, without the library learning what a theme is. PNG goes the other way
entirely: `cy.png()` on the live instance, which is by definition exactly what
is on screen.

## Styling

Tailwind v4 with a small set of CSS variables (`--gz-*`) defined for light and
dark on `:root` and `.dark`, mapped into Tailwind's theme with `@theme inline`.
Canvas colours live separately in `canvas/theme.ts` because Cytoscape cannot
read CSS variables; both palettes are defined in one place each.

## Testing

- **696 unit and component tests** (Vitest). The library tests check
  mathematics, not just types: known invariants for named graphs, witnesses
  verified against the graph they came from, blossom matching cross-checked
  against brute force on seeded random graphs, exact chromatic numbers against
  a chromatic polynomial, spanning tree counts against Cayley's formula, bridges
  and articulation points against a recompute-after-removal oracle.
- **Component tests** (React Testing Library) cover the inspector's clickable
  rows, the deferred hard section, mode toggles, the quick-command box and the
  home page. The SVG exporter is tested by parsing its output and asserting on
  the document — circle and label counts, the viewBox enclosing every stroke,
  arrowheads only for digraphs, escaped labels.
- **24 end-to-end flows** (Playwright) cover drawing a triangle and highlighting
  its odd cycle, the bipartition of C6, stepping Dijkstra to correct distances,
  save/reload persistence, undo/redo, the command palette, the negative-weight
  refusal, the empty state, DOT and SVG export, right-clicking a vertex and the
  canvas, placing a vertex from the keyboard, the tablet layout, and the home
  page's demo, calls to action, quick-start chips and route round-trip, and —
  against a build with no Supabase environment — that no account UI appears,
  that the whole anonymous workflow still runs, and that not a single request
  is made to a Supabase host. They
  assert on a small read-only `window.graphualize` hook for facts the DOM cannot
  show, because the graph is drawn to a canvas.

## Deliberate non-goals

No collaboration, no AI, and no backend the product depends on. Signing in is
optional: it changes where saves go, from this browser to the account, and
gates nothing — every feature, saving included, works signed out. The home page is a home page:
it explains and demonstrates the tool and then gets out of the way. There is no
sign-up, no pricing, no newsletter and no analytics. The serialisation format
carries a version number and the documents layer is a thin adapter over local
storage, so cloud sync could be added later without touching the graph library
or the UI.
