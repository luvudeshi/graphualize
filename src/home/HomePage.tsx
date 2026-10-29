import type { CSSProperties, ReactNode } from 'react'
import { useEditor } from '../state/store'
import { useTheme } from '../hooks/useTheme'
import { openEditor } from '../app/router'
import { prefersReducedMotion } from '../utils/platform'
import { HeroDemo } from './HeroDemo'
import { SavedGraphs } from './SavedGraphs'
import { FeatureGrid } from './FeatureGrid'
import { ExampleGallery } from './ExampleGallery'
import { Frontispiece } from './Frontispiece'
import { AccountMenu, AuthErrorNotice } from '../auth/AccountMenu'
import './home.css'

/**
 * The commands the quick-start opens, each set the way a mathematician would
 * write it. The button is named by the command itself, so what is read out is
 * what the workbench receives.
 */
const QUICK_START: { command: string; ink: string; label: ReactNode }[] = [
  { command: 'K5', ink: 'red', label: <><i>K</i><sub>5</sub></> },
  { command: 'C8', ink: 'blue', label: <><i>C</i><sub>8</sub></> },
  { command: 'Petersen', ink: 'yellow', label: 'Petersen' },
  { command: 'K3,3', ink: 'red', label: <><i>K</i><sub>3,3</sub></> },
  { command: 'Q4', ink: 'blue', label: <><i>Q</i><sub>4</sub></> },
  { command: 'G(20,0.2)', ink: 'yellow', label: <><i>G</i>(20, 0.2)</> },
]

/** The app's mark in the page's inks: three points, three primaries. */
const BrandMark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" className="gz-home-mark" aria-hidden="true">
    <path d="M5 6.5L21 9.5L11.5 21Z" className="gz-home-mark-edges" />
    <circle cx="5" cy="6.5" r="3.6" data-ink="red" />
    <circle cx="21" cy="9.5" r="3.6" data-ink="blue" />
    <circle cx="11.5" cy="21" r="3.6" data-ink="yellow" />
  </svg>
)

/* The theme toggle's two states as flat shapes: an ink crescent for the
   night edition, a yellow sun for the day. */
const MoonGlyph = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8.82 3.09A7.5 7.5 0 1 0 17.41 11.68A6.2 6.2 0 0 1 8.82 3.09Z" fill="currentColor" />
  </svg>
)

const SunGlyph = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" className="gz-home-sun">
    <circle cx="10" cy="10" r="4.2" />
    <path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1" />
  </svg>
)

/** A ruled arrow with a solid head, as Byrne would draw a direction. */
const ArrowGlyph = () => (
  <svg width={26} height={12} viewBox="0 0 26 12" aria-hidden="true" className="gz-home-arrow">
    <path d="M0 6h17" stroke="currentColor" strokeWidth="2" />
    <path d="M16 0.5L26 6L16 11.5Z" fill="currentColor" />
  </svg>
)

/** Staggers the title page's entrance; the animation itself lives in home.css. */
const rise = (delay: number) => ({ '--gz-delay': `${delay}ms` }) as CSSProperties

/**
 * A button rather than an `#examples` link: the URL hash is the router's, and a
 * fragment there would be read as a route.
 *
 * Scrolling alone would leave keyboard and screen reader users back in the
 * hero, so focus follows the view to the section's heading. It is moved
 * without scrolling, which would otherwise cut the smooth scroll short.
 */
const scrollToExamples = () => {
  document.getElementById('examples')?.scrollIntoView?.({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  })
  document.getElementById('home-examples')?.focus({ preventScroll: true })
}

/**
 * The front door, set as a page of Byrne's Euclid: a title page with the
 * proposition and its figure, the live demo as a plate, what the workbench
 * does as numbered definitions, and the examples as a page of figures. Every
 * route into the product is one click, and nothing here asks for an account.
 */
export const HomePage = () => {
  const { dark } = useTheme()
  const setTheme = useEditor((s) => s.setTheme)
  const savedName = useEditor((s) => s.name)
  const hasSession = useEditor((s) => s.doc.vertices.length > 0)

  return (
    <div className="gz-home">
      <header className="gz-home-head sticky top-0 z-30">
        <div className="gz-home-wrap gz-home-head-row">
          <span className="gz-home-brand">
            <BrandMark />
            <span>Graphualize</span>
          </span>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
            <button
              type="button"
              className="gz-home-icon-btn"
              onClick={() => setTheme(dark ? 'light' : 'dark')}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {dark ? <SunGlyph /> : <MoonGlyph />}
            </button>
            <AccountMenu compact />
            {/* On a phone the visible word is "Workbench", which says where the
                button goes beside an icon-only sign-in; the name stays whole. */}
            <button
              type="button"
              className="gz-home-open"
              onClick={() => openEditor()}
              aria-label="Open the workbench"
            >
              <span className="sm:hidden">Workbench</span>
              <span className="hidden sm:inline">Open the workbench</span>
            </button>
          </div>
        </div>
        <AuthErrorNotice />
      </header>

      <main>
        {/* The title page: the proposition beside its figure, set so that
            Plate I, the live demo, rises into the first screen. */}
        <section className="gz-home-wrap gz-home-hero">
          <p className="gz-home-prop gz-home-hero-prop gz-home-rise" aria-hidden="true">
            Prop. I.
          </p>
          <h1 className="gz-home-title gz-home-rise" style={rise(60)}>
            Graph theory that <em>shows its working.</em>
          </h1>
          <p className="gz-home-lede gz-home-rise" style={rise(140)}>
            A free graph theory workbench in your browser. Draw a{' '}graph, then click any property to
            see why it’s true.
          </p>

          <div className="gz-home-actions gz-home-rise" style={rise(220)}>
            <button type="button" className="gz-home-start" onClick={() => openEditor()}>
              <span className="max-w-[16rem] truncate">
                {hasSession ? `Continue “${savedName}”` : 'Start drawing'}
              </span>
              <ArrowGlyph />
            </button>
            <button type="button" className="gz-home-browse" onClick={scrollToExamples}>
              Browse examples
            </button>
          </div>

          <div className="gz-home-quick gz-home-rise" style={rise(300)}>
            <span className="gz-home-quick-intro text-[var(--gz-muted)]">or open</span>
            <span className="gz-home-quick-cmds">
              {QUICK_START.map(({ command, ink, label }) => (
                <button
                  key={command}
                  type="button"
                  aria-label={command}
                  onClick={() => openEditor(command)}
                  className="gz-home-cmd"
                  style={{ '--gz-cmd': `var(--gz-home-${ink})` } as CSSProperties}
                >
                  <span>{label}</span>
                </button>
              ))}
            </span>
          </div>

          <div className="gz-home-hero-figure gz-home-rise" style={rise(120)}>
            <Frontispiece />
          </div>
        </section>

        <div className="gz-home-wrap gz-home-plate-wrap gz-home-rise" style={rise(380)}>
          <HeroDemo />
        </div>

        <div className="gz-home-wrap">
          <SavedGraphs />
        </div>

        <section aria-labelledby="home-features" className="gz-home-wrap gz-home-section gz-home-features">
          <div className="gz-home-section-head">
            <p className="gz-home-prop" aria-hidden="true">
              Prop. II.
            </p>
            <h2 id="home-features" className="gz-home-h2">
              Everything a graph theory course asks for.
            </h2>
          </div>
          <FeatureGrid />
        </section>

        <section
          id="examples"
          aria-labelledby="home-examples"
          className="gz-home-wrap gz-home-section scroll-mt-20"
        >
          <div className="gz-home-section-head">
            <p className="gz-home-prop" aria-hidden="true">
              Prop. III.
            </p>
            {/* Focusable from script only, so "Browse examples" can take focus here. */}
            <h2 id="home-examples" tabIndex={-1} className="gz-home-h2">
              Start from a classic.
            </h2>
          </div>
          <ExampleGallery />
        </section>
      </main>

      <footer className="gz-home-colophon">
        <div className="gz-home-wrap">
          <svg width="74" height="18" viewBox="0 0 74 18" className="gz-home-fleuron" aria-hidden="true">
            <polygon points="9,1 17,17 1,17" data-ink="red" />
            <rect x="29" y="1" width="16" height="16" data-ink="yellow" />
            <circle cx="65" cy="9" r="8" data-ink="blue" />
          </svg>
          <p className="gz-home-colophon-name">Graphualize</p>
          <p className="gz-home-colophon-line">Draw graphs. Understand them.</p>
          <p className="gz-home-colophon-small">Built with React, TypeScript and Cytoscape.js</p>
        </div>
      </footer>
    </div>
  )
}
