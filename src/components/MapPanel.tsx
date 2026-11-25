'use client'

import type {ComponentProps} from 'react'
import {InfoCard} from './InfoCard'

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

type InfoCardProps = ComponentProps<typeof InfoCard>

/**
 * The selected photo, route or flight, shown in the sidebar or the sheet: a back control, then its details
 * (title, date, stats, elevation or altitude chart, Replay). Escape does the same as Back (InfoCard handles it).
 */
export function DetailsPanel({
  onBack,
  topRowClassName = '',
  ...card
}: Omit<InfoCardProps, 'onClose' | 'variant'> & {onBack: () => void; topRowClassName?: string}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex shrink-0 items-center border-b border-black/5 px-2 py-2 ${topRowClassName}`}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to results"
          className="flex h-10 items-center gap-1 rounded-full pl-2.5 pr-4 text-[14px] font-semibold text-black/75 hover:bg-black/[0.05] active:bg-black/[0.08]"
        >
          <BackIcon />
          Results
        </button>
      </div>
      <div data-sheet-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <InfoCard {...card} onClose={onBack} variant="panel" />
      </div>
    </div>
  )
}
