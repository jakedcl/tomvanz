import {useCallback, useSyncExternalStore} from 'react'

const listeners = new Set<() => void>()
/** Kept in memory too, so the flag still works when the browser won't let us use session storage. */
const memory = new Map<string, boolean>()

function read(key: string, fallback: boolean): boolean {
  const remembered = memory.get(key)
  if (remembered !== undefined) return remembered
  try {
    const stored = window.sessionStorage.getItem(key)
    if (stored !== null) return stored === '1'
  } catch {
    /* storage unavailable: use the fallback */
  }
  return fallback
}

/** A true/false setting remembered for this browser session (this tab, until it is closed). */
export function useSessionFlag(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => void listeners.delete(onChange)
    },
    () => read(key, fallback),
    () => fallback,
  )
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, next)
      try {
        window.sessionStorage.setItem(key, next ? '1' : '0')
      } catch {
        /* storage unavailable: the in-memory value still holds for this page */
      }
      for (const listener of [...listeners]) listener()
    },
    [key],
  )
  return [value, set]
}
