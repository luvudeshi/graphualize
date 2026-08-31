import { useState } from 'react'
import { Dialog } from './Dialog'
import { GENERATORS, defaultParams, estimateSize } from '../graph/generators'
import { applyGenerator } from '../state/actions'
import { useUi } from '../state/ui'

export const GenerateDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)
  const [activeId, setActiveId] = useState(GENERATORS[0]?.id ?? 'complete')
  const [values, setValues] = useState<Record<string, Record<string, number>>>({})
  const [seed, setSeed] = useState(1)

  const active = GENERATORS.find((g) => g.id === activeId) ?? GENERATORS[0]
  if (!active) return null

  const params = values[active.id] ?? defaultParams(active)
  const setParam = (key: string, value: number) =>
    setValues((prev) => ({ ...prev, [active.id]: { ...params, [key]: value } }))

  const estimate = estimateSize(active.id, params)

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Generate a graph"
      description="Classic families and random models. Parameters are validated before anything is drawn."
      width="max-w-3xl"
      footer={
        <>
          <button type="button" className="gz-btn border px-3" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="gz-btn gz-btn-primary px-3"
            onClick={() => {
              if (applyGenerator(active.id, params, seed)) close()
            }}
          >
            Generate {active.shortName}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[13rem_1fr]">
        <div className="gz-scroll max-h-96 space-y-3 border-r pr-3">
          {(['classic', 'random'] as const).map((category) => (
            <div key={category}>
              <p className="gz-label mb-1">{category}</p>
              <div className="space-y-0.5">
                {GENERATORS.filter((g) => g.category === category).map((generator) => (
                  <button
                    key={generator.id}
                    type="button"
                    onClick={() => setActiveId(generator.id)}
                    className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-[0.8125rem] transition-colors ${
                      generator.id === active.id
                        ? 'bg-[var(--gz-accent-soft)] text-[var(--gz-accent)]'
                        : 'hover:bg-[color-mix(in_oklab,var(--gz-border)_50%,transparent)]'
                    }`}
                  >
                    <span className="gz-num shrink-0 text-[0.6875rem] text-[var(--gz-faint)]">
                      {generator.shortName}
                    </span>
                    <span className="truncate">{generator.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-[0.875rem] font-semibold">{active.name}</h3>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">
            {active.description}
          </p>

          <div className="mt-4 space-y-3">
            {active.params.map((param) => (
              <label key={param.key} className="block">
                <span className="flex items-baseline justify-between">
                  <span className="text-[0.8125rem]">{param.label}</span>
                  <span className="gz-num text-[0.75rem] text-[var(--gz-muted)]">
                    {params[param.key]}
                  </span>
                </span>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step ?? (param.kind === 'int' ? 1 : 0.01)}
                  value={params[param.key] ?? param.default}
                  onChange={(event) => setParam(param.key, Number(event.target.value))}
                  className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--gz-border)] accent-[var(--gz-accent)]"
                />
                {param.description && (
                  <span className="mt-0.5 block text-[0.6875rem] text-[var(--gz-faint)]">
                    {param.description}
                  </span>
                )}
              </label>
            ))}
            {active.category === 'random' && (
              <label className="block">
                <span className="text-[0.8125rem]">Seed</span>
                <input
                  type="number"
                  className="gz-input gz-num mt-1"
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value) || 0)}
                />
                <span className="mt-0.5 block text-[0.6875rem] text-[var(--gz-faint)]">
                  The same seed always produces the same graph.
                </span>
              </label>
            )}
            {active.params.length === 0 && (
              <p className="text-[0.8125rem] text-[var(--gz-muted)]">
                This graph has no parameters.
              </p>
            )}
          </div>

          {estimate && (
            <p className="mt-4 gz-num text-[0.75rem] text-[var(--gz-faint)]">
              {estimate.vertices} vertices · {estimate.edges} edges
            </p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
