import { useEffect, useState } from 'react'
import { useEditor } from '../state/store'

const prefersDark = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolves the theme preference against the OS setting and applies it. */
export const useTheme = (): { dark: boolean } => {
  const preference = useEditor((s) => s.theme)
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const dark = preference === 'system' ? systemDark : preference === 'dark'

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  return { dark }
}
