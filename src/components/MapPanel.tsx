'use client'

import {useEffect, useRef, type PointerEvent, type ReactNode, type RefObject} from 'react'
import {sheetHeights, snapSheet, stepSheet, type SheetHeights, type SheetLevel} from '@/lib/sheet-snap'

const mobileQuery = '(max-width: 767px)'

type Props = {
  header: ReactNode
  children: ReactNode
  collapsed: boolean
  onToggleCollapsed: () => void
  level: SheetLevel
  onLevel: (level: SheetLevel) => void
  onHeights: (heights: SheetHeights) => void
  resultsRef: RefObject<HTMLUListElement | null>
}

type Drag = {
  startY: number
  startHeight: number
  height: number
  samples: {y: number; time: number}[]
  heights: SheetHeights
  pointerId?: number
  moved: boolean
}

function readHeights(panel: HTMLElement, top: HTMLElement) {
  const available = panel.parentElement?.clientHeight ?? 0
  const inset = parseFloat(getComputedStyle(panel).paddingBottom)
  return sheetHeights(available, top.offsetHeight + inset)
}

export function MapPanel({header, children, collapsed, onToggleCollapsed, level, onLevel, onHeights, resultsRef}: Props) {
  const panel = useRef<HTMLElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    if (!panel.current || !top.current) return
    const node = panel.current
    const header = top.current
    const media = window.matchMedia(mobileQuery)
    const measure = () => onHeights(media.matches ? readHeights(node, header) : {peek: 0, half: 0, full: 0})
    const observer = new ResizeObserver(measure)
    observer.observe(node.parentElement!)
    observer.observe(header)
    media.addEventListener('change', measure)
    measure()
    return () => {
      observer.disconnect()
      media.removeEventListener('change', measure)
    }
  }, [onHeights])

  function begin(y: number, pointerId?: number) {
    if (!panel.current || !top.current) return
    const height = panel.current.getBoundingClientRect().height
    drag.current = {
      startY: y, startHeight: height, height, pointerId, moved: false,
      samples: [{y, time: performance.now()}],
      heights: readHeights(panel.current, top.current),
    }
  }

  function move(y: number) {
    const active = drag.current
    const node = panel.current
    if (!active || !node) return false
    const delta = active.startY - y
    if (!active.moved && Math.abs(delta) < 5) return false
    active.moved = true
    active.height = Math.min(active.heights.full, Math.max(active.heights.peek, active.startHeight + delta))
    const time = performance.now()
    active.samples = [...active.samples.filter((sample) => time - sample.time <= 100), {y, time}]
    node.dataset.dragging = 'true'
    node.style.setProperty('--map-sheet-drag-height', `${active.height}px`)
    return true
  }

  function end(cancelled: boolean) {
    const active = drag.current
    const node = panel.current
    drag.current = null
    if (!active?.moved || !node) return
    const [first] = active.samples
    const last = active.samples.at(-1)!
    const elapsed = Math.max(last.time - first.time, 16)
    const velocity = performance.now() - last.time < 90 ? (first.y - last.y) / elapsed : 0
    const next = cancelled ? level : snapSheet(level, active.height, velocity, active.heights)
    delete node.dataset.dragging
    node.style.removeProperty('--map-sheet-drag-height')
    onLevel(next)
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!window.matchMedia(mobileQuery).matches || event.button !== 0 || !event.isPrimary ||
      (event.target as HTMLElement).closest('input')) return
    suppressClick.current = false
    begin(event.clientY, event.pointerId)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId || !move(event.clientY)) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId)
    suppressClick.current = true
  }

  // Only a downward, vertical pull at the top takes ownership from the native list scroll.
  useEffect(() => {
    const list = resultsRef.current
    if (!list) return
    let start: {x: number; y: number} | null = null
    let pulling = false
    const touchStart = (event: TouchEvent) => {
      start = window.matchMedia(mobileQuery).matches && event.touches.length === 1 && list.scrollTop <= 0
        ? {x: event.touches[0].clientX, y: event.touches[0].clientY}
        : null
    }
    const touchMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1 || !event.cancelable) return
      const {clientX, clientY} = event.touches[0]
      if (!pulling) {
        const delta = clientY - start.y
        if (Math.abs(delta) < 5 && Math.abs(clientX - start.x) < 5) return
        if (list.scrollTop > 0 || delta < 5 || delta <= Math.abs(clientX - start.x)) {
          start = null
          return
        }
        begin(start.y)
        pulling = true
      }
      event.preventDefault()
      move(clientY)
    }
    const touchEnd = (event: TouchEvent) => {
      if (pulling) end(event.type === 'touchcancel')
      pulling = false
      start = null
    }
    list.addEventListener('touchstart', touchStart, {passive: true})
    list.addEventListener('touchmove', touchMove, {passive: false})
    list.addEventListener('touchend', touchEnd)
    list.addEventListener('touchcancel', touchEnd)
    return () => {
      list.removeEventListener('touchstart', touchStart)
      list.removeEventListener('touchmove', touchMove)
      list.removeEventListener('touchend', touchEnd)
      list.removeEventListener('touchcancel', touchEnd)
    }
  })

  return (
    <aside ref={panel} className="map-panel" data-level={level} aria-label="Map controls">
      <button
        type="button"
        className="map-panel-collapse"
        aria-label={collapsed ? 'Expand map sidebar' : 'Collapse map sidebar'}
        aria-controls="map-panel-content"
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <Chevron collapsed={collapsed} />
      </button>
      <div id="map-panel-content" className="map-panel-content">
        <div
          ref={top}
          className="map-panel-top"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) end(false) }}
          onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) end(true) }}
          onClickCapture={(event) => {
            if (event.detail && suppressClick.current) {
              event.preventDefault()
              event.stopPropagation()
              suppressClick.current = false
            }
          }}
        >
          <button
            type="button"
            className="map-sheet-handle"
            aria-label={level === 'peek' ? 'Expand map controls' : 'Lower map controls'}
            aria-expanded={level !== 'peek'}
            aria-controls="map-panel-body"
            onClick={() => onLevel(level === 'half' ? 'peek' : 'half')}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              onLevel(stepSheet(level, event.key === 'ArrowUp' ? 1 : -1))
            }}
          >
            <span aria-hidden />
          </button>
          {header}
        </div>
        <div id="map-panel-body" className="map-panel-body">{children}</div>
      </div>
    </aside>
  )
}

function Chevron({collapsed}: {collapsed: boolean}) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
    </svg>
  )
}
