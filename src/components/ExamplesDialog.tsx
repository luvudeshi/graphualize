import { Dialog } from './Dialog'
import { EXAMPLES } from '../graph/examples'
import { loadExample } from '../state/actions'
import { useUi } from '../state/ui'

const CATEGORY_TITLES: Record<string, string> = {
  basics: 'Basics',
  named: 'Named graphs',
  'classic-questions': 'Classic questions',
}

export const ExamplesDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Example gallery"
      description="Graphs worth having on the canvas the first time you try something."
      width="max-w-3xl"
    >
      <div className="space-y-5">
        {(['basics', 'named', 'classic-questions'] as const).map((category) => (
          <div key={category}>
            <p className="gz-label mb-1.5">{CATEGORY_TITLES[category]}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.filter((example) => example.category === category).map((example) => (
                <button
                  key={example.id}
                  type="button"
                  onClick={() => {
                    loadExample(example.id)
                    close()
                  }}
                  className="rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--gz-accent)] hover:bg-[var(--gz-accent-soft)]"
                >
                  <span className="block text-[0.8125rem] font-medium">{example.name}</span>
                  <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-[var(--gz-muted)]">
                    {example.blurb}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
