import { useEffect, useRef, useState } from 'react'

/**
 * Returns `value` after it has stayed unchanged for `delay` ms. Used to keep
 * the medium-cost analyses off the critical path while the user is editing.
 */
export const useDebounced = <T,>(value: T, delay = 140): T => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const handle = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(handle)
  }, [value, delay])
  return settled
}

/** Fires `tick` at `rate` steps per second while `active`. */
export const useInterval = (tick: () => void, active: boolean, rate: number): void => {
  const saved = useRef(tick)
  useEffect(() => {
    saved.current = tick
  })
  useEffect(() => {
    if (!active) return
    const ms = Math.max(60, 1000 / Math.max(0.1, rate))
    const handle = window.setInterval(() => saved.current(), ms)
    return () => window.clearInterval(handle)
  }, [active, rate])
}
