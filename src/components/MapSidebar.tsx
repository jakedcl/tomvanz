'use client'

import type {ReactNode} from 'react'

function Chevron({open}: {open: boolean}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[18px] w-[18px] transition-transform duration-200 motion-reduce:transition-none ${open ? '' : 'rotate-180'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

/**
 * The desktop panel: a left sidebar beside the map (the map takes the rest of the width). A button hides it down
 * to a thin edge, and the same button brings it back.
 */
export function MapSidebar({
  open,
  onToggle,
  header,
  children,
}: {
  open: boolean
  onToggle: () => void
  /** Pinned at the top (the search box). */
  header?: ReactNode
  children: ReactNode
}) {
  return (
    <aside
      aria-label="Map controls"
      className={`relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-black/10 bg-white transition-[width] duration-200 ease-out motion-reduce:transition-none ${
        open ? 'w-[360px]' : 'w-[44px]'
      }`}
    >
      {/* Fixed width inside, so hiding the sidebar slides it away instead of squashing its contents. */}
      <div id="map-sidebar-content" inert={!open} className="flex h-full min-h-0 w-[360px] flex-col">
        {header ? <div className="flex shrink-0 items-center gap-2 py-3 pl-4 pr-14">{header}</div> : null}
        {children}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={open}
        aria-controls="map-sidebar-content"
        className="absolute right-[3px] top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.06] text-black/70 hover:bg-black/[0.1] active:scale-95"
      >
        <Chevron open={open} />
      </button>
    </aside>
  )
}
