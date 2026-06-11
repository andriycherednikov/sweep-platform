// web/src/hooks/useEventStream.js
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { pushNotification } from '../notifications.js'
import { getAdminBadge, refreshAdminBadge } from '../admin.js'

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
      if (ev.type === 'watch' || ev.type === 'support') {
        qc.invalidateQueries({ queryKey: ['social'] })
        // ambient floating reaction when someone backs/switches a team (not on remove)
        if (ev.type === 'support' && ev.supporting) {
          pushNotification({ personId: ev.personId, teamCode: ev.supporting, fixtureId: ev.fixtureId, action: ev.action })
        }
      } else if (ev.type === 'photo-pending') {
        // a new upload landed in the queue — bump the admin badge (admins only)
        if (getAdminBadge().isAdmin) refreshAdminBadge()
      } else if (ev.type === 'score' || ev.type === 'sync' || ev.type === 'photo-approved' || ev.type === 'photo-removed') {
        qc.invalidateQueries({ queryKey: ['sweep'] })
        if ((ev.type === 'photo-approved' || ev.type === 'photo-removed') && getAdminBadge().isAdmin) refreshAdminBadge()
      }
    }
    return () => es.close()
  }, [qc])
}
