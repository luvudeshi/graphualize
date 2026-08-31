import type { SVGProps } from 'react'

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

export const CursorIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 3l7.5 17 2.3-6.9 6.9-2.3z" />
  </svg>
)

export const VertexIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="5.2" />
    <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2" />
  </svg>
)

export const EdgeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="6" cy="18" r="2.6" />
    <circle cx="18" cy="6" r="2.6" />
    <path d="M7.9 16.1l8.2-8.2" />
  </svg>
)

export const EraseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 20h16" />
    <path d="M6.5 16.5l7-7a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-4 4H9z" />
  </svg>
)

export const UndoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9h11a5 5 0 1 1 0 10h-5" />
    <path d="M8 5L4 9l4 4" />
  </svg>
)

export const RedoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 9H9a5 5 0 1 0 0 10h5" />
    <path d="M16 5l4 4-4 4" />
  </svg>
)

export const FitIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
  </svg>
)

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
)

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
)

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="7" y="5.5" width="3.4" height="13" rx="1" />
    <rect x="13.6" y="5.5" width="3.4" height="13" rx="1" />
  </svg>
)

export const StepBackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M16 5.5v13L7 12z" />
    <rect x="4" y="5.5" width="2.2" height="13" rx="1" />
  </svg>
)

export const StepForwardIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13L17 12z" />
    <rect x="17.8" y="5.5" width="2.2" height="13" rx="1" />
  </svg>
)

export const RestartIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
)

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)

export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
)

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M15.8 15.8L20 20" />
  </svg>
)

export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a1 1 0 0 1 1-1h9" />
  </svg>
)

export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 4l1.8 4.9L18.7 11l-4.9 1.8L12 17.7l-1.8-4.9L5.3 11l4.9-2.1z" />
  </svg>
)

export const GraphMarkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 20, height: 20, ...p })}>
    <circle cx="6" cy="7" r="2.4" />
    <circle cx="18" cy="9" r="2.4" />
    <circle cx="11" cy="18" r="2.4" />
    <path d="M8.2 7.6l7.5 1M7.2 9.2l3 6.6M16.9 11.2l-4.5 5.2" />
  </svg>
)

/**
 * Google's "G" in its four brand colours. Google's branding guidelines require
 * the mark to be used unmodified, so this one ignores `base()` and carries its
 * own fills rather than inheriting `currentColor` like every other icon here.
 */
export const GoogleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg width={16} height={16} viewBox="0 0 48 48" aria-hidden="true" {...p}>
    <path
      fill="#4285F4"
      d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
    />
    <path
      fill="#FBBC05"
      d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
    />
    <path
      fill="#EA4335"
      d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
    />
  </svg>
)

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)
