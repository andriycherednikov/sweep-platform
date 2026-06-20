// web/src/hooks/useEventStream.js
import { useEffect, useRef } from 'react'
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
  // De-dupe match-event notifications: the worker can re-emit a goal/card (e.g.
  // overlapping poll ticks), so only the first occurrence of a given event keys
  // a notification. The cache still invalidates so scores stay current.
  const seen = useRef(new Set())
  const notifyOnce = (key, fn) => { if (seen.current.has(key)) return; seen.current.add(key); fn() }
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/stream')
    es.onopen = () => {
      qc.invalidateQueries({ queryKey: ['sweep'] })
      qc.invalidateQueries({ queryKey: ['social'] })
      qc.invalidateQueries({ queryKey: ['coins'] })
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
        // derive only kick-off / full-time by diffing against the fixture we still hold
        // (goals now arrive as their own `goal` event, with the real scorer)
        const prev = S.fixture(ev.fixtureId)
        if (prev) {
          if (prev.status !== 'live' && ev.status === 'live') {
            pushNotification({ kind: 'match', event: 'start', fixtureId: ev.fixtureId })
          } else if (prev.status === 'live' && ev.status === 'final') {
            pushNotification({ kind: 'match', event: 'final', fixtureId: ev.fixtureId, score: ev.score })
          }
        }
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'goal') {
        notifyOnce(`goal|${ev.fixtureId}|${ev.minute}|${ev.teamCode}|${ev.player}|${ev.detail}`, () =>
          pushNotification({ kind: 'match', event: 'goal', fixtureId: ev.fixtureId, teamCode: ev.teamCode, player: ev.player, assist: ev.assist, minute: ev.minute, detail: ev.detail, score: ev.score }))
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'card') {
        notifyOnce(`card|${ev.fixtureId}|${ev.minute}|${ev.teamCode}|${ev.player}|${ev.card}|${ev.detail}`, () =>
          pushNotification({ kind: 'match', event: 'card', fixtureId: ev.fixtureId, teamCode: ev.teamCode, player: ev.player, minute: ev.minute, card: ev.card, detail: ev.detail }))
        qc.invalidateQueries({ queryKey: ['sweep'] })
      } else if (ev.type === 'bet' || ev.type === 'bet-settled') {
        qc.invalidateQueries({ queryKey: ['coins'] })
        // ambient floating reaction: who backed what (a single selection, or a multi)
        if (ev.type === 'bet') {
          if (ev.parlay) {
            pushNotification({ kind: 'multi', personId: ev.personId, legCount: ev.legCount })
          } else {
            pushNotification({ kind: 'bet', personId: ev.personId, fixtureId: ev.fixtureId, market: ev.market, selection: ev.selection })
          }
        }
      } else if (ev.type === 'sync' || ev.type === 'photo-approved' || ev.type === 'photo-removed') {
        qc.invalidateQueries({ queryKey: ['sweep'] })
        if ((ev.type === 'photo-approved' || ev.type === 'photo-removed') && getAdminBadge().isAdmin) refreshAdminBadge()
      }
    }
    return () => es.close()
  }, [qc])
}
