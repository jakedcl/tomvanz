'use client'

import {type ReactNode, useEffect, useRef} from 'react'

type Props = {
  children: ReactNode
  onHeightChange: (height: number) => void
}

/** Bottom-docked detail chrome for the map (full width on phones, capped width on desktop). */
export function MapDetailPanel({children, onHeightChange}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const report = () => onHeightChange(node.getBoundingClientRect().height)
    const observer = new ResizeObserver(report)
    observer.observe(node)
    report()
    return () => observer.disconnect()
  }, [onHeightChange, children])

  return (
    <div
      ref={ref}
      className="tv-detail-panel pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[max(10px,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto w-full max-w-lg px-3 md:px-4">{children}</div>
    </div>
  )
}