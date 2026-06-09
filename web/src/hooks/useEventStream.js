// web/src/hooks/useEventStream.js
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Subscribe once to GET /api/stream. Each event invalidates the relevant
 * TanStack Query cache so others' actions and live goals appear within ~1s.
 * Native EventSource auto-reconnects (server sends `retry:`); on (re)open we
 * invalidate both queries to catch up on anything missed while disconnected.
 */
export function useEventStream() {
  const qc = useQueryClient()
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/stream')
    es.onopen = () => {
      qc.invalidateQueries({ queryKey: ['sweep'] })
      qc.invalidateQueries({ queryKey: ['social'] })
    }
    es.onmessage = (e) => {
      let ev
      try { ev = JSON.parse(e.data) } catch { return }
      if (ev.type === 'watch' || ev.type === 'support') qc.invalidateQueries({ queryKey: ['social'] })
      else if (ev.type === 'score' || ev.type === 'sync' || ev.type === 'photo-approved' || ev.type === 'photo-removed') qc.invalidateQueries({ queryKey: ['sweep'] })
    }
    return () => es.close()
  }, [qc])
}
