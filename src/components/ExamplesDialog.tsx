import { useMemo, type CSSProperties } from 'react'
import { Dialog } from './Dialog'
import { EXAMPLES } from '../graph/examples'
import { loadExample } from '../state/actions'
import { useUi } from '../state/ui'
import { GraphThumbnail } from '../home/GraphThumbnail'
import '../styles/dialogs2.css'

const CATEGORY_TITLES: Record<string, string> = {
  basics: 'Basics',
  named: 'Named graphs',
  'classic-questions': 'Classic questions',
}

const CATEGORIES = ['basics', 'named', 'classic-questions'] as const

/** The most places a plate waits its turn to be seated. */
const SEAT_LIMIT = 8

/**
 * The examples as a grid of small plates, each with its drawing on a screen:
 * every one is drawn from its own document, so a drawing never disagrees with
 * what opens.
 */
export const ExamplesDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)

  // Drawn only while the dialog is open.
  const sections = useMemo(() => {
    if (!open) return []
    return CATEGORIES.map((category) => ({
      category,
      entries: EXAMPLES.filter((example) => example.category === category).map((example) => ({
        example,
        doc: example.build(),
      })),
    }))
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Example gallery"
      description="Graphs worth having on the canvas the first time you try something."
      width="max-w-3xl"
    >
      {sections.map(({ category, entries }) => (
        <section key={category} className="gz-wb-dlg-plate">
          <h3 className="gz-wb-dlg-marker">{CATEGORY_TITLES[category]}</h3>
          <ul className="gz-wb-dlg-figs">
            {entries.map(({ example, doc }, index) => (
              // Seated one after another as the dialog opens; the stagger
              // stops growing after the first few so the last is never late.
              <li
                key={example.id}
                className="gz-anim-seat"
                style={{ '--gz-i': Math.min(index, SEAT_LIMIT) } as CSSProperties}
              >
                <button
                  type="button"
                  onClick={() => {
                    loadExample(example.id)
                    close()
                  }}
                  className="gz-wb-dlg-fig"
                >
                  <span className="gz-wb-dlg-fig-art">
                    <GraphThumbnail doc={doc} width={240} height={150} padding={22} radius={4.6} />
                  </span>
                  <span className="gz-wb-dlg-fig-head">
                    <span className="gz-wb-dlg-fig-name">{example.name}</span>
                    <span className="gz-wb-dlg-fig-count" aria-hidden="true">
                      {doc.vertices.length}v · {doc.edges.length}e
                    </span>
                  </span>
                  <span className="gz-wb-dlg-fig-blurb">{example.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Dialog>
  )
}
