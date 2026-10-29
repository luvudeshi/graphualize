import { useId, useState, type ReactNode } from 'react'
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
    hint: 'Whole numbers drawn at random, a new set each time.',
  },
  {
    id: 'length',
    label: 'Length',
    hint: `Each edge weighs its drawn length, scaled so the median edge is ${LENGTH_SCALE}.`,
  },
]

/**
 * A generator's short name set as mathematics: Kₙ with an italic letter and a
 * subscript, G(n, p) with italic arguments, and plain names (grid, Petersen)
 * left roman. The accessible name stays the plain text, on the control.
 */
export const MathName = ({ text, className = '' }: { text: string; className?: string }) => {
  const visual = mathVisual(text)
  return (
    <>
      <span className={`gz-wb-math ${className}`} aria-hidden>
        {visual}
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}

const mathVisual = (text: string): ReactNode => {
  const indexed = /^([A-Z])([a-z](?:,[a-z])?)$/.exec(text)
  if (indexed)
    return (
      <>
        <i>{indexed[1]}</i>
        <sub>
          <i>{indexed[2]}</i>
        </sub>
      </>
    )
  const call = /^([A-Za-z]+)\((.+)\)$/.exec(text)
  if (call) {
    const head = call[1]!
    return (
      <>
        {head.length === 1 ? <i>{head}</i> : head}(
        {call[2]!.split(',').map((arg, i) => (
          <span key={i}>
            {i > 0 && ',\u2009'}
            <i>{arg.trim()}</i>
          </span>
        ))}
        )
      </>
    )
  }
  return text
}

/** The generator's name without its trailing notation, which is set beside it as maths. */
const plainName = (name: string, shortName: string): ReactNode => {
  const squash = (t: string) => t.replace(/\s+/g, '')
  const words = name.split(' ')
  const last = words[words.length - 1] ?? ''
  if (words.length > 1 && squash(last) === squash(shortName)) return words.slice(0, -1).join(' ')
  // "Random graph G(n, p)" ends in two words of notation.
  const lastTwo = words.slice(-2).join('')
  if (words.length > 2 && squash(lastTwo) === squash(shortName)) return words.slice(0, -2).join(' ')
  // "Grid Pr × Pc": set each indexed letter as maths.
  return words.map((word, i) => (
    <span key={i}>
      {i > 0 && ' '}
      {/^[A-Z][a-z]$/.test(word) ? <MathName text={word} /> : word}
    </span>
  ))
}

/** An empty or half-typed field must not read as 0, so it becomes NaN and is refused. */
const readWhole = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text))

export const GenerateDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)
  const docWeighted = useEditor((s) => s.doc.weighted)
  const [activeId, setActiveId] = useState(GENERATORS[0]?.id ?? 'complete')
  const [values, setValues] = useState<Record<string, Record<string, number>>>({})
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
    setValues((prev) => ({
      ...prev,
      [active.id]: { ...params, [key]: value },
    }))

  const estimate = estimateSize(active.id, params)

  const weightMode: WeightMode = weightChoice ?? (docWeighted ? 'unit' : 'none')
  const weighting: EdgeWeighting | null =
    weightMode === 'none'
      ? null
      : weightMode === 'random'
        ? {
            kind: 'random',
            min: readWhole(range.min),
            max: readWhole(range.max),
          }
        : { kind: weightMode }
  const weightError = weighting ? weightingProblem(weighting) : null
  const weightHint = WEIGHT_MODES.find((mode) => mode.id === weightMode)?.hint

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
            aria-label={`Generate ${active.shortName}`}
            disabled={weightError !== null}
            onClick={() => {
              if (applyGenerator(active.id, params, weighting)) close()
            }}
          >
            Generate <MathName text={active.shortName} />
          </button>
        </>
      }
    >
      <div className="gz-wb-gen grid gap-5 sm:grid-cols-[17.5rem_1fr]">
        <nav aria-label="Generators" className="gz-wb-gen-index gz-scroll sm:max-h-[32rem] sm:pr-4">
          {(['classic', 'random'] as const).map((category) => (
            <div key={category} className="gz-wb-gen-group">
              <p className="gz-marker gz-wb-gen-cat">{category}</p>
              <div>
                {GENERATORS.filter((g) => g.category === category).map((generator) => (
                  <button
                    key={generator.id}
                    type="button"
                    aria-label={`${generator.shortName} ${generator.name}`}
                    aria-current={generator.id === active.id ? 'true' : undefined}
                    onClick={() => setActiveId(generator.id)}
                    className="gz-wb-gen-row"
                  >
                    <span className="gz-wb-gen-name">
                      {plainName(generator.name, generator.shortName)}
                    </span>
                    <MathName text={generator.shortName} className="gz-wb-gen-math" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="gz-wb-gen-detail">
          <p className="gz-marker">{active.category}</p>
          <h3 className="gz-wb-gen-title">
            {plainName(active.name, active.shortName)} <MathName text={active.shortName} />
          </h3>
          <p className="gz-wb-gen-desc">{active.description}</p>

          <div className="gz-wb-gen-params">
            {active.params.map((param) => (
              <label key={param.key} className="block">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="gz-label">{param.label}</span>
                  <span className="gz-num gz-wb-gen-value">{params[param.key]}</span>
                </span>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step ?? (param.kind === 'int' ? 1 : 0.01)}
                  value={params[param.key] ?? param.default}
                  onChange={(event) => setParam(param.key, Number(event.target.value))}
                  className="gz-wb-range"
                />
                {param.description && <span className="gz-wb-hint">{param.description}</span>}
              </label>
            ))}
            {active.params.length === 0 && (
              <p className="gz-wb-hint">This graph has no parameters.</p>
            )}

            <div>
              <span id={`${weightGroup}-label`} className="gz-label">
                Edge weights
              </span>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div
                  role="radiogroup"
                  aria-labelledby={`${weightGroup}-label`}
                  className="gz-wb-seg"
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
                      <span className="gz-wb-seg-option">{mode.label}</span>
                    </label>
                  ))}
                </div>
                {weightMode === 'random' && (
                  <div className="gz-wb-gen-range flex items-center gap-3">
                    <label className="flex items-center gap-1.5">
                      Min
                      <input
                        type="number"
                        step={1}
                        className="gz-input gz-num w-[4.25rem]"
                        value={range.min}
                        onChange={(event) => setRange({ ...range, min: event.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-1.5">
                      Max
                      <input
                        type="number"
                        step={1}
                        className="gz-input gz-num w-[4.25rem]"
                        value={range.max}
                        onChange={(event) => setRange({ ...range, max: event.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
              {weightError ? (
                <span role="alert" className="gz-wb-hint gz-wb-hint-error">
                  {weightError}
                </span>
              ) : (
                <span className="gz-wb-hint">{weightHint}</span>
              )}
            </div>
          </div>

          {estimate && (
            <p className="gz-num gz-wb-gen-estimate">
              {estimate.vertices} vertices · {estimate.edges} edges
            </p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
