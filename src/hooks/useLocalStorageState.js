import { useCallback, useEffect, useState } from 'react'

export function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored == null ? initialValue : JSON.parse(stored)
    } catch { return initialValue }
  })
  const update = useCallback(next => setValue(current => typeof next === 'function' ? next(current) : next), [])
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
  }, [key, value])
  return [value, update]
}
