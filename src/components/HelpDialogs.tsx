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
      [formatShortcut('mod+O'), 'Open a saved graph'],
      [formatShortcut('mod+N'), 'New graph'],
    ],
  },
]

export const ShortcutsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="max-w-2xl">
    <div className="grid gap-5 sm:grid-cols-2">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="gz-label mb-1.5">{group.title}</p>
          <dl className="space-y-1">
            {group.items.map(([key, description]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-[0.8125rem] text-[var(--gz-muted)]">{description}</dt>
                <dd className="gz-num shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem]">
                  {key}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  </Dialog>
)

export const AboutDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)
  return (
    <Dialog open={open} onClose={close} title="About Graphualize" width="max-w-lg">
      <p className="text-[0.875rem] leading-relaxed">
        Graphualize is a workbench for graph theory. Draw a graph, watch its properties update as
        you edit, and click any property to see the mathematical evidence drawn on the graph
        itself.
      </p>
      <p className="mt-3 text-[0.875rem] leading-relaxed text-[var(--gz-muted)]">
        Results that cannot be computed exactly are never dressed up as if they could. Anything
        NP-hard is either computed exactly under a stated size limit, or reported as bounds with
        the reason. Eigenvalues are labelled as the floating-point approximations they are.
      </p>
      <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--gz-muted)]">Storage</dt>
          <dd className="text-right">
            Saved graphs live in your Google account. Without one, nothing is kept when the tab
            closes.
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--gz-muted)]">Built with</dt>
          <dd className="gz-num">React · TypeScript · Cytoscape.js · Zustand</dd>
        </div>
      </dl>
    </Dialog>
  )
}
