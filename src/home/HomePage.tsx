import { useEffect, useState, type CSSProperties } from 'react'
import { useEditor } from '../state/store'
import { useTheme } from '../hooks/useTheme'
import { openEditor } from '../app/router'
import { prefersReducedMotion } from '../utils/platform'
import { HeroDemo } from './HeroDemo'
import { SavedGraphs } from './SavedGraphs'
import { FeatureGrid } from './FeatureGrid'
import { ExampleGallery } from './ExampleGallery'
import { MoonIcon, SunIcon } from '../components/Icons'
import { AccountMenu, AuthErrorNotice } from '../auth/AccountMenu'
import './home.css'

const QUICK_START = ['K5', 'C8', 'Petersen', 'K3,3', 'Q4', 'G(20,0.2)']

/** The graph mark reversed out of an accent tile: the app's icon, at any size. */
const BrandMark = ({ size = 28 }: { size?: number }) => (
  <span className="gz-home-mark" style={{ width: size, height: size }} aria-hidden="true">
    <svg
      viewBox="0 0 24 24"
      width={Math.round(size * 0.64)}
      height={Math.round(size * 0.64)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
    >
      <path d="M8.2 7.6l7.5 1M7.2 9.2l3 6.6M16.9 11.2l-4.5 5.2" />
      <circle cx="6" cy="7" r="2.8" fill="currentColor" stroke="none" />
      <circle cx="18" cy="9" r="2.8" fill="currentColor" stroke="none" />
      <circle cx="11" cy="18" r="2.8" fill="currentColor" stroke="none" />
    </svg>
  </span>
)

const ArrowIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** Staggers the hero's entrance; the animation itself lives in home.css. */
const rise = (delay: number) => ({ '--gz-delay': `${delay}ms` }) as CSSProperties

/**
 * The header sits transparently over the hero and only takes on its rule and
 * frosted background once there is page content scrolling underneath it.
 */
const useScrolled = (threshold = 8): boolean => {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [threshold])
  return scrolled
}

/**
 * A button rather than an `#examples` link: the URL hash is the router's, and a
 * fragment there would be read as a route.
 */
const scrollToExamples = () => {
  document.getElementById('examples')?.scrollIntoView?.({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  })
}

/**
 * The front door: a headline, the live demo, then what the workbench does and
 * where to start. Every route into the product is one click, and nothing here
 * asks for an account.
 */
export const HomePage = () => {
  const { dark } = useTheme()
  const setTheme = useEditor((s) => s.setTheme)
  const savedName = useEditor((s) => s.name)
  const hasSession = useEditor((s) => s.doc.vertices.length > 0)
  const scrolled = useScrolled()

  return (
    // `overflow-x: clip` contains the backdrop's glow without creating a
    // scroll container, which would break the sticky header.
    <div className="relative isolate min-h-full overflow-x-clip bg-[var(--gz-bg)] text-[var(--gz-text)]">
      <div className="gz-home-backdrop" aria-hidden="true" />

      <header className="gz-home-header sticky top-0 z-30" data-scrolled={scrolled}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-8">
          <span className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">Graphualize</span>
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="gz-home-icon-btn"
              onClick={() => setTheme(dark ? 'light' : 'dark')}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            <AccountMenu compact />
            <button
              type="button"
              className="gz-home-btn gz-home-btn-ink ml-1 h-9 rounded-[0.625rem] px-3.5 text-[0.8125rem]"
              onClick={() => openEditor()}
            >
              <span>
                Open <span className="hidden sm:inline">the workbench</span>
              </span>
            </button>
          </div>
        </div>
        <AuthErrorNotice />
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-12 text-center sm:px-8 sm:pt-20">
          <h1 className="gz-home-title gz-home-rise mx-auto max-w-4xl">
            Graph theory that <span className="gz-home-accent">shows its working.</span>
          </h1>
          <p
            className="gz-home-rise mx-auto mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-balance text-[var(--gz-muted)] sm:mt-6 sm:text-[1.1875rem]"
            style={rise(70)}
          >
            Draw a graph. Click any property to see why it’s true.
          </p>

          <div
            className="gz-home-rise mt-8 flex flex-wrap items-center justify-center gap-3"
            style={rise(140)}
          >
            <button
              type="button"
              className="gz-home-btn gz-home-btn-primary"
              onClick={() => openEditor()}
            >
              <span className="max-w-[16rem] truncate">
                {hasSession ? `Continue “${savedName}”` : 'Start drawing'}
              </span>
              <ArrowIcon />
            </button>
            <button type="button" className="gz-home-btn gz-home-btn-quiet" onClick={scrollToExamples}>
              Browse examples
            </button>
          </div>

          <div
            className="gz-home-rise mt-6 flex flex-wrap items-center justify-center gap-1.5"
            style={rise(210)}
          >
            <span className="basis-full pb-1 text-[0.75rem] text-[var(--gz-faint)] sm:basis-auto sm:pb-0 sm:pr-1">
              or open
            </span>
            {QUICK_START.map((command) => (
              <button
                key={command}
                type="button"
                onClick={() => openEditor(command)}
                className="gz-home-chip"
              >
                {command}
              </button>
            ))}
          </div>
        </section>

        <div
          className="gz-home-rise relative isolate mx-auto mt-12 max-w-6xl px-3 sm:mt-16 sm:px-8"
          style={rise(280)}
        >
          <div className="gz-home-glow" aria-hidden="true" />
          <div className="gz-home-stage">
            <HeroDemo />
          </div>
        </div>

        {/* Positioned so it paints above the stage's glow, which spills downwards. */}
        <div className="relative mx-auto max-w-6xl px-4 sm:px-8">
          <SavedGraphs />
        </div>

        <section
          aria-labelledby="home-features"
          className="mx-auto max-w-6xl px-4 pt-24 sm:px-8 sm:pt-32"
        >
          <h2 id="home-features" className="gz-home-h2 text-center">
            Everything a graph theory course asks for.
          </h2>
          <FeatureGrid />
        </section>

        <section
          id="examples"
          aria-labelledby="home-examples"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 pt-24 sm:px-8 sm:pb-32 sm:pt-32"
        >
          <h2 id="home-examples" className="gz-home-h2 text-center">
            Start from a classic.
          </h2>
          <ExampleGallery />
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-8 text-[0.75rem] text-[var(--gz-faint)] sm:px-8">
          <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-[var(--gz-text)]">
            <BrandMark size={20} />
            Graphualize
          </span>
          <span>Draw graphs. Understand them.</span>
          <span className="sm:ml-auto">Built with React, TypeScript and Cytoscape.js</span>
        </div>
      </footer>
    </div>
  )
}
