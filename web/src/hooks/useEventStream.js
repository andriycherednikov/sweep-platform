// web/src/hooks/useEventStream.js
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SWEEP as S } from '../data.js'
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
      } else if (ev.type === 'score') {
        // derive a match-event reaction by diffing against the fixture we still hold
        // (the invalidate below refetches asynchronously, so S.fixture is the prior state)
        const prev = S.fixture(ev.fixtureId)
        if (prev && Array.isArray(ev.score)) {
          const [na, nb] = ev.score
          const oa = prev.score ? prev.score[0] : 0
          const ob = prev.score ? prev.score[1] : 0
          if (prev.status !== 'live' && ev.status === 'live') {
            pushNotification({ kind: 'match', event: 'start', fixtureId: ev.fixtureId })
          } else if (prev.status === 'live' && ev.status === 'final') {
            pushNotification({ kind: 'match', event: 'final', fixtureId: ev.fixtureId, score: ev.score })
          } else if (ev.status === 'live' && (na > oa || nb > ob)) {
            pushNotification({ kind: 'match', event: 'goal', fixtureId: ev.fixtureId, teamCode: na > oa ? prev.t1 : prev.t2, score: ev.score })
          }
        }
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'sync' || ev.type === 'photo-approved' || ev.type === 'photo-removed') {
        qc.invalidateQueries({ queryKey: ['sweep'] })
        if ((ev.type === 'photo-approved' || ev.type === 'photo-removed') && getAdminBadge().isAdmin) refreshAdminBadge()
      }
    }
    return () => es.close()
  }, [qc])
}
