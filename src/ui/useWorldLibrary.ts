import { useEffect, useState } from 'react'
import type { WorldLibrary } from '@/core/domain/world-library'
import type { WorldLibraryService } from '@/core/application/world-library'
export function useWorldLibrary(service: WorldLibraryService) {
  const [library, setLibrary] = useState<WorldLibrary>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const refresh = () => void service.load().then((value) => { if (live) { setLibrary(value); setError('') } }, (e) => { if (live) setError(String(e)) })
    refresh(); const unsubscribe = service.subscribe(refresh)
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { live = false; unsubscribe(); document.removeEventListener('visibilitychange', visible) }
  }, [service])
  return { library, error }
}
