import '@testing-library/jest-dom/vitest'

// Node 25+ defines its own `localStorage` / `sessionStorage` globals, which are
// `undefined` unless Node is started with `--localstorage-file`. They shadow
// jsdom's, so every storage call in a test would throw. Put jsdom's back.
declare const jsdom: { window: Window } | undefined
if (typeof jsdom !== 'undefined') {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => jsdom.window[key],
    })
  }
}

// Cytoscape and layout code touch APIs jsdom does not implement.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
}
