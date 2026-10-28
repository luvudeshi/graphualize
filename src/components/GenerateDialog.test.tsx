import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GenerateDialog } from './GenerateDialog'
import { useEditor } from '../state/store'

const state = () => useEditor.getState()
const weights = () => state().doc.edges.map((e) => e.weight)

/** Opens the dialog on a generator, the way a person would. */
const openOn = async (generatorName: string) => {
  const user = userEvent.setup()
  render(<GenerateDialog open />)
  await user.click(screen.getByRole('button', { name: new RegExp(generatorName) }))
  return user
}

const setField = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
  text: string,
) => {
  const field = screen.getByRole('spinbutton', { name: label })
  await user.clear(field)
  if (text) await user.type(field, text)
}

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
})

describe('GenerateDialog edge weights', () => {
  it('follows the document until a choice is made', () => {
    const { unmount } = render(<GenerateDialog open />)
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked()
    unmount()

    state().setWeighted(true)
    render(<GenerateDialog open />)
    expect(screen.getByRole('radio', { name: 'Unit' })).toBeChecked()
  })

  it('generates random integer weights in the chosen range', async () => {
    const user = await openOn('Complete graph Kn')
    // A classic family has no seed field until its weights need one.
    expect(screen.queryByRole('spinbutton', { name: /^Seed/ })).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Random' }))
    expect(screen.getByRole('spinbutton', { name: /^Seed/ })).toBeInTheDocument()
    await setField(user, 'Min', '2')
    await setField(user, 'Max', '20')
    await user.click(screen.getByRole('button', { name: 'Generate Kn' }))

    expect(state().doc.weighted).toBe(true)
    expect(state().doc.edges).toHaveLength(10)
    expect(weights().every((w) => Number.isInteger(w) && w! >= 2 && w! <= 20)).toBe(true)
  })

  it('reuses the seed, so the same seed gives the same weights', async () => {
    const user = await openOn('Cycle Cn')
    await user.click(screen.getByRole('radio', { name: 'Random' }))
    await setField(user, /^Seed/, '7')

    const generateButton = screen.getByRole('button', { name: 'Generate Cn' })
    await user.click(generateButton)
    const first = weights()
    await user.click(generateButton)
    expect(weights()).toEqual(first)

    await setField(user, /^Seed/, '8')
    await user.click(generateButton)
    expect(weights()).not.toEqual(first)
  })

  it('explains a bad range and will not generate with it', async () => {
    const user = await openOn('Path Pn')
    await user.click(screen.getByRole('radio', { name: 'Random' }))
    await setField(user, 'Min', '9')
    await setField(user, 'Max', '1')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The smallest weight (9) cannot be larger than the largest (1).',
    )
    expect(screen.getByRole('button', { name: 'Generate Pn' })).toBeDisabled()

    await setField(user, 'Max', '')
    expect(screen.getByRole('alert')).toHaveTextContent(/whole numbers/)
  })

  it('weighs by drawn length', async () => {
    const user = await openOn('Petersen graph')
    await user.click(screen.getByRole('radio', { name: 'Length' }))
    await user.click(screen.getByRole('button', { name: 'Generate Petersen' }))
    expect(state().doc.weighted).toBe(true)
    expect(new Set(weights())).toEqual(new Set([6, 10, 14]))
  })

  it('can generate an unweighted graph from a weighted document', async () => {
    state().setWeighted(true)
    const user = await openOn('Cycle Cn')
    await user.click(screen.getByRole('radio', { name: 'None' }))
    await user.click(screen.getByRole('button', { name: 'Generate Cn' }))
    expect(state().doc.weighted).toBe(false)
  })
})
