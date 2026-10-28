import { useId, useState } from 'react'
import { Dialog } from './Dialog'
import { GENERATORS, defaultParams, estimateSize } from '../graph/generators'
import {
  DEFAULT_WEIGHT_RANGE,
  LENGTH_SCALE,
  weightingProblem,
  type EdgeWeighting,
} from '../graph/generators/weights'
import { applyGenerator } from '../state/actions'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'

type WeightMode = 'none' | EdgeWeighting['kind']

const WEIGHT_MODES: { id: WeightMode; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'An unweighted graph.' },
  { id: 'unit', label: 'Unit', hint: 'Every edge weighs 1.' },
  {
    id: 'random',
    label: 'Random',
    hint: 'Whole numbers drawn with the seed below, so the same seed gives the same weights.',
  },
  {
    id: 'length',
    label: 'Length',
    hint: `Each edge weighs its drawn length, scaled so the median edge is ${LENGTH_SCALE}.`,
  },
]

/** An empty or half-typed field must not read as 0, so it becomes NaN and is refused. */
const readWhole = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text))

export const GenerateDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)
  const docWeighted = useEditor((s) => s.doc.weighted)
  const [activeId, setActiveId] = useState(GENERATORS[0]?.id ?? 'complete')
  const [values, setValues] = useState<Record<string, Record<string, number>>>({})
  const [seed, setSeed] = useState(1)
  // null follows the document's mode until the user picks, which keeps the old
  // behaviour (unit weights when weighted) for anyone who never touches it.
  const [weightChoice, setWeightChoice] = useState<WeightMode | null>(null)
  const [range, setRange] = useState({
    min: String(DEFAULT_WEIGHT_RANGE.min),
    max: String(DEFAULT_WEIGHT_RANGE.max),
  })
  const weightGroup = useId()

  const active = GENERATORS.find((g) => g.id === activeId) ?? GENERATORS[0]
  if (!active) return null

  const params = values[active.id] ?? defaultParams(active)
  const setParam = (key: string, value: number) =>
    setValues((prev) => ({ ...prev, [active.id]: { ...params, [key]: value } }))

  const estimate = estimateSize(active.id, params)

  const weightMode: WeightMode = weightChoice ?? (docWeighted ? 'unit' : 'none')
  const weighting: EdgeWeighting | null =
    weightMode === 'none'
      ? null
      : weightMode === 'random'
        ? { kind: 'random', min: readWhole(range.min), max: readWhole(range.max) }
        : { kind: weightMode }
  const weightError = weighting ? weightingProblem(weighting) : null
  const weightHint = WEIGHT_MODES.find((mode) => mode.id === weightMode)?.hint
  const seeded = active.category === 'random' || weightMode === 'random'

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
            disabled={weightError !== null}
            onClick={() => {
              if (applyGenerator(active.id, params, seed, weighting)) close()
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
            {active.params.length === 0 && (
              <p className="text-[0.8125rem] text-[var(--gz-muted)]">
                This graph has no parameters.
              </p>
            )}

            <div>
              <span id={`${weightGroup}-label`} className="text-[0.8125rem]">
                Edge weights
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div
                  role="radiogroup"
                  aria-labelledby={`${weightGroup}-label`}
                  className="inline-flex gap-0.5 rounded-lg border p-0.5"
                >
                  {WEIGHT_MODES.map((mode) => (
                    <label key={mode.id} className="cursor-pointer">
                      <input
                        type="radio"
                        name={weightGroup}
                        value={mode.id}
                        checked={weightMode === mode.id}
                        onChange={() => setWeightChoice(mode.id)}
                        className="peer sr-only"
                      />
                      <span className="block rounded-md px-2.5 py-1 text-[0.8125rem] text-[var(--gz-muted)] transition-colors hover:text-[var(--gz-text)] peer-checked:bg-[var(--gz-accent-soft)] peer-checked:text-[var(--gz-accent)] peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--gz-accent)]">
                        {mode.label}
                      </span>
                    </label>
                  ))}
                </div>
                {weightMode === 'random' && (
                  <div className="flex items-center gap-2 text-[0.8125rem]">
                    <label className="flex items-center gap-1.5">
                      Min
                      <input
                        type="number"
                        step={1}
                        className="gz-input gz-num w-16"
                        value={range.min}
                        onChange={(event) => setRange({ ...range, min: event.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Max
                      <input
                        type="number"
                        step={1}
                        className="gz-input gz-num w-16"
                        value={range.max}
                        onChange={(event) => setRange({ ...range, max: event.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
              {weightError ? (
                <span
                  role="alert"
                  className="mt-0.5 block text-[0.6875rem] text-[var(--gz-danger)]"
                >
                  {weightError}
                </span>
              ) : (
                <span className="mt-0.5 block text-[0.6875rem] text-[var(--gz-faint)]">
                  {weightHint}
                </span>
              )}
            </div>

            {seeded && (
              <label className="block">
                <span className="text-[0.8125rem]">Seed</span>
                <input
                  type="number"
                  className="gz-input gz-num mt-1"
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value) || 0)}
                />
                <span className="mt-0.5 block text-[0.6875rem] text-[var(--gz-faint)]">
                  {active.category !== 'random'
                    ? 'The same seed always produces the same weights.'
                    : weightMode === 'random'
                      ? 'The same seed always produces the same graph and weights.'
                      : 'The same seed always produces the same graph.'}
                </span>
              </label>
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
