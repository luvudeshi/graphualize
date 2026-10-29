import { Dialog } from './Dialog'
import { useUi } from '../state/ui'
import { formatShortcut } from '../utils/platform'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select tool'],
      ['A', 'Add a vertex at the centre of the view'],
      ['N', 'Vertex tool'],
      ['E', 'Edge tool'],
      ['X', 'Erase tool'],
      ['Esc', 'Cancel the current action, clear highlighting'],
    ],
  },
  {
    title: 'Editing',
    items: [
      [formatShortcut('mod+Z'), 'Undo'],
      [formatShortcut('mod+shift+Z'), 'Redo'],
      [formatShortcut('mod+Y'), 'Redo (Windows convention)'],
      [formatShortcut('mod+A'), 'Select everything'],
      ['Delete / Backspace', 'Delete the selection'],
      ['Double-click a vertex', 'Rename it'],
      ['Double-click an edge', 'Edit its weight'],
      ['Right-click', 'Actions for a vertex, an edge or the canvas'],
      ['Arrow keys', 'Nudge selected vertices'],
    ],
  },
  {
    title: 'View',
    items: [
      ['F', 'Fit the graph to the screen'],
      [formatShortcut('mod+K'), 'Command palette'],
      ['?', 'This dialog'],
    ],
  },
  {
    title: 'Algorithm playback',
    items: [
      ['Space', 'Play or pause'],
      ['→ / ←', 'Step forward or backward (while playing is paused)'],
    ],
  },
  {
    title: 'File',
    items: [
      [formatShortcut('mod+S'), 'Save'],
      [formatShortcut('mod+shift+S'), 'Save as…'],
      [formatShortcut('mod+O'), 'Open a saved graph'],
      [formatShortcut('mod+N'), 'New graph'],
    ],
  },
]

/**
 * A key, or alternatives split on " / ", each set as a keycap; a mouse
 * gesture ("Double-click a vertex") is said in italic, as it is not a key.
 */
const Keys = ({ spec }: { spec: string }) => {
  if (/click|keys/i.test(spec)) return <span className="gz-wb-dlg-gesture">{spec}</span>
  const alternatives = spec.split(' / ')
  return (
    <>
      {alternatives.map((key, i) => (
        <span key={key} className="contents">
          {i > 0 && <span className="gz-wb-dlg-or">or</span>}
          <kbd className="gz-wb-dlg-kbd">{key}</kbd>
        </span>
      ))}
    </>
  )
}

export const ShortcutsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="max-w-3xl">
    <div className="gz-wb-dlg-keys">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="gz-wb-dlg-marker">{group.title}</h3>
          <dl className="gz-wb-dlg-keytable">
            {group.items.map(([key, description]) => (
              <div key={key}>
                <dt>
                  <Keys spec={key} />
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  </Dialog>
)

export const AboutDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)
  return (
    <Dialog open={open} onClose={close} title="About Graphualize" width="max-w-lg">
      <p className="gz-wb-dlg-prose">
        Graphualize is a workbench for graph theory. Draw a graph, watch its properties update as
        you edit, and click any property to see the mathematical evidence drawn on the graph
        itself.
      </p>
      <p className="gz-wb-dlg-caption mt-3">
        Results that cannot be computed exactly are never dressed up as if they could. Anything
        NP-hard is either computed exactly under a stated size limit, or reported as bounds with
        the reason. Eigenvalues are labelled as the floating-point approximations they are.
      </p>
      <dl className="gz-wb-dlg-facts">
        <div>
          <dt>Storage</dt>
          <dd>
            Saved to your Google account when signed in, and to this browser otherwise. Nothing
            is autosaved: use File → Save.
          </dd>
        </div>
        <div>
          <dt>Built with</dt>
          <dd>React · TypeScript · Cytoscape.js · Zustand</dd>
        </div>
      </dl>
    </Dialog>
  )
}
