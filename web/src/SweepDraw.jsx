import { useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SWEEP as S, onSweepData } from './data.js'
import { PersonAvatar, Icon } from './components.jsx'
import { bulkPostOwnership } from './api/client.js'
import { planSweep } from './lib/sweepDraw.js'

const STEP_MS = 280       // spotlight dwell per person
const COMMIT_CHUNK = 500  // matches the bulk endpoint's maxItems

// Prefer an explicit prop (tests stub it), else the context client; guarded so the
// component can be unit-tested without a QueryClientProvider (the hook would throw).
function useResolvedQc(override) {
  let hookQc = null
  try { hookQc = useQueryClient() } catch { hookQc = null }
  return override || hookQc
}

function reducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// The admin "Sweep" tab: pick N teams/person, draw an even top-up across everyone,
// reveal it draw-from-hat style, and (only on Confirm) persist additively.
export function SweepDraw({ onToast, queryClient }) {
  const qc = useResolvedQc(queryClient)
  const [, bump] = useState(0)
  useEffect(() => onSweepData(() => bump((n) => n + 1)), [])

  const people = S.people
  const teamList = S.teamList
  const maxN = Math.max(1, teamList.length)

  const [n, setN] = useState(2)
  const [phase, setPhase] = useState('idle') // idle | revealing | drawn | committing
  const [draft, setDraft] = useState(null)
  const [spot, setSpot] = useState(0)        // # of reveal entries completed
  const timer = useRef(null)

  const clearTimers = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => clearTimers, [])

  const summary = useMemo(() => {
    let totalAdd = 0, getting = 0, already = 0
    for (const p of people) {
      const need = Math.max(0, n - (p.teams?.length || 0))
      if (need > 0) { totalAdd += need; getting++ } else already++
    }
    return { totalAdd, getting, already }
  }, [people, n])

  const reveal = draft?.reveal || []
  const revealIndexById = useMemo(() => {
    const m = {}; reveal.forEach((r, i) => { m[r.personId] = i }); return m
  }, [draft])

  const revealedUpto = (phase === 'drawn' || phase === 'committing') ? reveal.length : spot
  const isRevealed = (personId) => {
    const idx = revealIndexById[personId]
    return idx !== undefined && idx < revealedUpto
  }
  const activeId = phase === 'revealing' && spot > 0 ? reveal[spot - 1]?.personId : null

  // pool owner counts: current ownership + newly-revealed allocations
  const liveCounts = useMemo(() => {
    const m = {}
    for (const t of teamList) m[t.code] = t.owners ? t.owners.length : 0
    if (draft) for (const row of draft.added) if (isRevealed(row.personId)) m[row.teamCode] = (m[row.teamCode] || 0) + 1
    return m
  }, [teamList, draft, revealedUpto])

  function runDraw() {
    clearTimers()
    const seed = Math.floor(Math.random() * 0x7fffffff)
    const d = planSweep(people, teamList, { teamsPerPerson: n, seed })
    setDraft(d)
    if (!d.reveal.length || reducedMotion()) { setSpot(d.reveal.length); setPhase('drawn'); return }
    setSpot(0); setPhase('revealing')
    const tick = (i) => {
      timer.current = setTimeout(() => {
        const next = i + 1
        setSpot(next)
        if (next >= d.reveal.length) { setPhase('drawn'); timer.current = null }
        else tick(next)
      }, STEP_MS)
    }
    tick(0)
  }

  function skip() { clearTimers(); setSpot(reveal.length); setPhase('drawn') }
  function reset() { clearTimers(); setDraft(null); setSpot(0); setPhase('idle') }

  async function confirm() {
    if (!draft || !draft.added.length) return
    clearTimers(); setPhase('committing')
    try {
      for (let i = 0; i < draft.added.length; i += COMMIT_CHUNK) {
        await bulkPostOwnership(draft.added.slice(i, i + COMMIT_CHUNK))
      }
      onToast?.('Sweep saved')
      qc?.invalidateQueries({ queryKey: ['sweep'] })
      reset()
    } catch {
      onToast?.("Couldn't save — try again"); setPhase('drawn')
    }
  }

  const peopleSorted = useMemo(() => people.slice().sort((a, b) => a.name.localeCompare(b.name)), [people])
  const drawing = phase === 'revealing'
  const live = phase !== 'idle' && draft

  return (
    <div className="scroll pad screen-anim" style={{ paddingTop: 10 }}>
      <div className="wrap">
        <div className="sweep-controls">
          <div className="sweep-n">
            <span className="alloc-lbl">Teams per person</span>
            <div className="sweep-stepper">
              <button type="button" className="allocbtn" aria-label="Fewer teams" disabled={n <= 1 || live} onClick={() => setN((v) => Math.max(1, v - 1))}><span aria-hidden="true">−</span></button>
              <b className="sweep-n-val">{n}</b>
              <button type="button" className="allocbtn" aria-label="More teams" disabled={n >= maxN || live} onClick={() => setN((v) => Math.min(maxN, v + 1))}><Icon.plus /></button>
            </div>
          </div>
          <p className="sweep-summary">
            {summary.totalAdd === 0
              ? `Everyone already has ${n} team${n === 1 ? '' : 's'}.`
              : `Adds ${summary.totalAdd} team${summary.totalAdd === 1 ? '' : 's'} to ${summary.getting} ${summary.getting === 1 ? 'person' : 'people'}` + (summary.already ? ` · ${summary.already} already at ${n}` : '')}
          </p>
          <div className="sweep-actions">
            {phase === 'idle' && (
              <button className="cta" disabled={summary.totalAdd === 0} onClick={runDraw}><Icon.ball /> Run sweep</button>
            )}
            {phase === 'revealing' && (
              <button className="cta sweep-skip" onClick={skip}>Skip</button>
            )}
            {phase === 'drawn' && (
              <>
                <button className="allocbtn sweep-reroll" onClick={runDraw}><Icon.swap /> Re-roll</button>
                <button className="cta sweep-confirm" onClick={confirm}><Icon.check /> Confirm</button>
              </>
            )}
            {phase === 'committing' && (
              <button className="cta" disabled><Icon.spinner /> Saving…</button>
            )}
          </div>
        </div>

        <div className="sweepgrid">
          {/* People (left) */}
          <div className="sweep-col">
            <h4 className="adminsec-h">People <span className="ct">{people.length}</span></h4>
            <div className="plist sweep-people">
              {peopleSorted.map((p) => {
                const fresh = (live && draft.byPerson[p.id]) || []
                const shown = isRevealed(p.id) || phase === 'drawn' || phase === 'committing'
                const full = !live && Math.max(0, n - (p.teams?.length || 0)) === 0
                return (
                  <div className={"prow sweep-person" + (p.id === activeId ? " is-drawing" : "") + (full ? " is-full" : "")} key={p.id}>
                    <PersonAvatar p={p} cls="pav" />
                    <div className="pi" style={{ flex: 1, minWidth: 0 }}>
                      <b>{p.name}</b>
                      <div className="tms tms-wrap sweep-slot">
                        {(p.teams || []).map((tc) => (
                          <span className="t tc-flag sweep-old-flag" key={"o" + tc}><img className="flag" src={S.flag(tc, 40)} alt="" /></span>
                        ))}
                        {fresh.map((tc, i) => (
                          <span className={"t tc-flag sweep-new-flag" + (shown ? " in" : " pending")} key={"n" + tc} style={{ '--i': i }}>
                            <img className="flag" src={S.flag(tc, 40)} alt={S.team(tc)?.name || tc} />
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="pcount"><b>{(p.teams?.length || 0) + (shown ? fresh.length : 0)}</b><small>teams</small></div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Team pool / "hat" (right) */}
          <div className="sweep-col">
            <h4 className="adminsec-h">Teams <span className="ct">{teamList.length}</span></h4>
            <div className={"sweep-pool" + (drawing ? " is-shuffling" : "")}>
              {teamList.map((t) => (
                <div className="sweep-pool-team" key={t.code}>
                  <img className="flag" src={S.flag(t.code, 40)} alt="" />
                  <span className="sweep-pool-name">{t.name}</span>
                  <span className="sweep-pool-count">{liveCounts[t.code] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
