import { useEditor } from '../state/store'
import { applyTransformById } from '../state/actions'

const Chip = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="gz-wb-chip"
  >
    {label}
  </button>
)

const Action = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    className="gz-wb-btn"
    data-danger={danger || undefined}
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
      <div className="gz-wb-sel">
        <label className="gz-wb-field">
          <span className="gz-wb-field-label">Label</span>
          <input
            key={`${vertexId}:${graph.label(vertexId)}`}
            className="gz-wb-input"
            defaultValue={graph.label(vertexId)}
            onBlur={(event) => renameVertex(vertexId, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>

        <dl className="gz-wb-stats">
          <div className="gz-wb-stat">
            <dt>Degree</dt>
            <span className="gz-wb-leader" aria-hidden="true" />
            <dd className="gz-wb-num">{graph.degree(vertexId)}</dd>
          </div>
          {directed && (
            <>
              <div className="gz-wb-stat">
                <dt>Indegree</dt>
                <span className="gz-wb-leader" aria-hidden="true" />
                <dd className="gz-wb-num">{graph.inDegree(vertexId)}</dd>
              </div>
              <div className="gz-wb-stat">
                <dt>Outdegree</dt>
                <span className="gz-wb-leader" aria-hidden="true" />
                <dd className="gz-wb-num">{graph.outDegree(vertexId)}</dd>
              </div>
            </>
          )}
        </dl>

        <div>
          <span className="gz-wb-field-label">Neighbours</span>
          <div className="gz-wb-chips">
            {neighbours.length === 0 && <span className="gz-wb-none">none</span>}
            {neighbours.map((id) => (
              <Chip key={id} label={graph.label(id)} onClick={() => select([id], [])} />
            ))}
          </div>
        </div>

        <div className="gz-wb-actions">
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
      <div className="gz-wb-sel">
        <p className="gz-wb-edge-title">
          {graph.label(edge.source)}
          <span className="gz-wb-edge-arrow">{directed ? '→' : '—'}</span>
          {graph.label(edge.target)}
        </p>
        {weighted && (
          <label className="gz-wb-field">
            <span className="gz-wb-field-label">Weight</span>
            <input
              key={`${edgeId}:${edge.weight ?? 1}`}
              className="gz-wb-input"
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
        <div className="gz-wb-actions">
          {directed && <Action label="Reverse" onClick={() => reverseEdge(edgeId)} />}
          <Action label="Subdivide" onClick={() => applyTransformById('subdivide-edge')} />
          <Action label="Contract" onClick={() => applyTransformById('contract-edge')} />
          <Action label="Delete" danger onClick={deleteSelection} />
        </div>
      </div>
    )
  }

  return (
    <div className="gz-wb-sel">
      <p className="gz-wb-lede">
        <span className="gz-wb-num">{selectedVertices.length}</span>{' '}
        {selectedVertices.length === 1 ? 'vertex' : 'vertices'} and{' '}
        <span className="gz-wb-num">{selectedEdges.length}</span>{' '}
        {selectedEdges.length === 1 ? 'edge' : 'edges'} selected.
      </p>
      <div className="gz-wb-actions">
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
