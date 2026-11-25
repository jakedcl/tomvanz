'use client'

import type {ReactNode} from 'react'

/** The desktop panel: a fixed 360 px sidebar beside the map (the map takes the rest of the width). */
export function MapSidebar({header, children}: {header?: ReactNode; children: ReactNode}) {
  return (
    <aside
      aria-label="Map controls"
      className="relative z-20 flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-r border-black/10 bg-white"
    >
      {/* Pinned at the top (the search box). */}
      {header ? <div className="flex shrink-0 items-center gap-2 px-4 py-3">{header}</div> : null}
      {children}
    </aside>
  )
}
