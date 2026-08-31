import { useEditor } from '../state/store'
import { applyTransformById } from '../state/actions'

const Chip = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="gz-num rounded border px-1.5 py-0.5 text-[0.75rem] text-[var(--gz-muted)] transition-colors hover:border-[var(--gz-accent)] hover:text-[var(--gz-accent)]"
  >
    {label}
  </button>
)

const Action = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    className={`gz-btn border px-2 py-1 text-[0.75rem] ${danger ? 'text-[var(--gz-danger)]' : ''}`}
  >
    {label}
  </button>
)

export const SelectionPanel = () => {
  const graph = useEditor((s) => s.graph)
  const selectedVertices = useEditor((s) => s.selectedVertices)
  const selectedEdges = useEditor((s) => s.selectedEdges)
  const renameVertex = useEditor((s) => s.renameVertex)
  const setEdgeWeight = useEditor((s) => s.setEdgeWeight)
  const reverseEdge = useEditor((s) => s.reverseEdge)
  const deleteSelection = useEditor((s) => s.deleteSelection)
  const select = useEditor((s) => s.select)
  const startAlgorithm = useEditor((s) => s.startAlgorithm)
  const weighted = useEditor((s) => s.doc.weighted)
  const directed = useEditor((s) => s.doc.directed)

  const singleVertex = selectedVertices.length === 1 && selectedEdges.length === 0
  const singleEdge = selectedEdges.length === 1 && selectedVertices.length === 0
  const vertexId = singleVertex ? selectedVertices[0]! : null
  const edgeId = singleEdge ? selectedEdges[0]! : null

  if (!selectedVertices.length && !selectedEdges.length) return null

  if (vertexId) {
    const neighbours = [...new Set(graph.neighbors(vertexId).map((n) => n.to))]
    return (
      <div className="space-y-2 px-2.5 py-2">
        <label className="block">
          <span className="gz-label">Label</span>
          <input
            key={`${vertexId}:${graph.label(vertexId)}`}
            className="gz-input mt-1"
            defaultValue={graph.label(vertexId)}
            onBlur={(event) => renameVertex(vertexId, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>

        <dl className="grid grid-cols-3 gap-1 text-[0.75rem]">
          <div>
            <dt className="gz-label">Degree</dt>
            <dd className="gz-num">{graph.degree(vertexId)}</dd>
          </div>
          {directed && (
            <>
              <div>
                <dt className="gz-label">In</dt>
                <dd className="gz-num">{graph.inDegree(vertexId)}</dd>
              </div>
              <div>
                <dt className="gz-label">Out</dt>
                <dd className="gz-num">{graph.outDegree(vertexId)}</dd>
              </div>
            </>
          )}
        </dl>

        <div>
          <span className="gz-label">Neighbours</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {neighbours.length === 0 && (
              <span className="text-[0.75rem] text-[var(--gz-faint)]">none</span>
            )}
            {neighbours.map((id) => (
              <Chip key={id} label={graph.label(id)} onClick={() => select([id], [])} />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 pt-1">
          <Action label="BFS from here" onClick={() => startAlgorithm('bfs', { source: vertexId })} />
          <Action label="DFS from here" onClick={() => startAlgorithm('dfs', { source: vertexId })} />
          <Action
            label="Shortest paths"
            onClick={() => startAlgorithm('dijkstra', { source: vertexId })}
          />
          <Action label="Delete" danger onClick={deleteSelection} />
        </div>
      </div>
    )
  }

  if (edgeId) {
    const edge = graph.edge(edgeId)
    if (!edge) return null
    return (
      <div className="space-y-2 px-2.5 py-2">
        <p className="gz-num text-[0.8125rem]">
          {graph.label(edge.source)} {directed ? '→' : '—'} {graph.label(edge.target)}
        </p>
        {weighted && (
          <label className="block">
            <span className="gz-label">Weight</span>
            <input
              key={`${edgeId}:${edge.weight ?? 1}`}
              className="gz-input mt-1"
              inputMode="decimal"
              defaultValue={String(edge.weight ?? 1)}
              onBlur={(event) => {
                const parsed = Number(event.target.value)
                if (Number.isFinite(parsed)) setEdgeWeight(edgeId, parsed)
                else event.target.value = String(edge.weight ?? 1)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          {directed && <Action label="Reverse" onClick={() => reverseEdge(edgeId)} />}
          <Action label="Subdivide" onClick={() => applyTransformById('subdivide-edge')} />
          <Action label="Contract" onClick={() => applyTransformById('contract-edge')} />
          <Action label="Delete" danger onClick={deleteSelection} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-2.5 py-2">
      <p className="text-[0.8125rem] text-[var(--gz-muted)]">
        {selectedVertices.length} vertices and {selectedEdges.length} edges selected.
      </p>
      <div className="flex flex-wrap gap-1">
        {selectedVertices.length > 0 && (
          <Action
            label="Induced subgraph"
            onClick={() => applyTransformById('induced-subgraph')}
          />
        )}
        <Action label="Delete selection" danger onClick={deleteSelection} />
      </div>
    </div>
  )
}
