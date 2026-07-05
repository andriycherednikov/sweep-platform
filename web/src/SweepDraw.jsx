import { useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SWEEP as S, onSweepData } from './data.js'
import { PersonAvatar, Icon, Flag } from './components.jsx'
import { bulkPostOwnership } from './api/client.js'
import { planSweep } from './lib/sweepDraw.js'

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

// Teams-per-person that spreads all teams as evenly as possible across everyone.
function suggestN(teamCount, peopleCount) {
  if (!peopleCount) return 1
  return Math.max(1, Math.round(teamCount / peopleCount))
}

const randSeed = () => Math.floor(Math.random() * 0x7fffffff)

// Module-scoped so revealed chips don't remount (and replay their pop) every tick.
function OwnerChip({ person, fresh }) {
  const p = person || { name: '?', initials: '?', av: '#888' }
  return (
    <span className={"sweep-owner-chip" + (fresh ? " in" : "")}>
      <span className="sweep-ownav" style={{ background: p.av }}>{p.initials}</span>
      <span className="sweep-owner-name">{p.name}</span>
    </span>
  )
}

// The admin "Sweep" tab: pick N teams/person, draw an even top-up across everyone,
// reveal it one team at a time, and (only on Confirm) persist additively.
export function SweepDraw({ onToast, queryClient }) {
  const qc = useResolvedQc(queryClient)
  const [, bump] = useState(0)
  useEffect(() => onSweepData(() => bump((x) => x + 1)), [])

  const people = S.people
  const teamList = S.teamList
  const maxN = Math.max(1, teamList.length)
  const byId = S.peopleById || {}

  const [n, setN] = useState(() => suggestN(teamList.length, people.length))
  const [phase, setPhase] = useState('idle') // idle | revealing | drawn | committing
  const [draft, setDraft] = useState(null)
  const [step, setStep] = useState(0)        // # of individual allocations revealed
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

  const added = draft?.added || []
  const lockN = phase === 'revealing' || phase === 'committing'
  const previewing = phase === 'drawn' || phase === 'committing'
  const revealedCount = previewing ? added.length : step
  const activeRow = phase === 'revealing' && step > 0 ? added[step - 1] : null

  // newly-assigned (personId list) per team, up to the reveal cursor
  const newOwnersByTeam = useMemo(() => {
    const m = {}
    for (let i = 0; i < revealedCount; i++) {
      const r = added[i]
      ;(m[r.teamCode] = m[r.teamCode] || []).push(r.personId)
    }
    return m
  }, [draft, revealedCount])

  // newly-assigned codes per person, up to the reveal cursor
  const newTeamsByPerson = useMemo(() => {
    const m = {}
    for (let i = 0; i < revealedCount; i++) {
      const r = added[i]
      ;(m[r.personId] = m[r.personId] || []).push(r.teamCode)
    }
    return m
  }, [draft, revealedCount])

  function startReveal(d) {
    setDraft(d)
    if (!d.added.length || reducedMotion()) { setStep(d.added.length); setPhase('drawn'); return }
    setStep(0); setPhase('revealing')
    const interval = Math.max(45, Math.min(200, Math.round(9000 / d.added.length)))
    const tick = (i) => {
      timer.current = setTimeout(() => {
        const next = i + 1
        setStep(next)
        if (next >= d.added.length) { setPhase('drawn'); timer.current = null }
        else tick(next)
      }, interval)
    }
    tick(0)
  }

  function runDraw() {
    clearTimers()
    startReveal(planSweep(people, teamList, { teamsPerPerson: n, seed: randSeed() }))
  }

  // Adjust teams-per-person between draws. While previewing, redraw instantly
  // (no animation) so the effect of the new N is visible right away.
  function changeN(delta) {
    const nv = Math.max(1, Math.min(maxN, n + delta))
    if (nv === n || lockN) return
    setN(nv)
    if (draft) {
      clearTimers()
      const d = planSweep(people, teamList, { teamsPerPerson: nv, seed: randSeed() })
      if (!d.added.length) { setDraft(null); setStep(0); setPhase('idle') }
      else { setDraft(d); setStep(d.added.length); setPhase('drawn') }
    }
  }

  function skip() { clearTimers(); setStep(added.length); setPhase('drawn') }
  function reset() { clearTimers(); setDraft(null); setStep(0); setPhase('idle'); setN(suggestN(teamList.length, people.length)) }

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
  const live = phase !== 'idle' && draft

  return (
    <div className="scroll pad screen-anim" style={{ paddingTop: 10 }}>
      <div className="wrap">
        <div className="sweep-controls">
          <div className="sweep-n">
            <span className="alloc-lbl">Teams per person</span>
            <p className="sweep-summary">
              {summary.totalAdd === 0
                ? `Everyone already has ${n} team${n === 1 ? '' : 's'}.`
                : `${live ? 'Drawing' : 'Adds'} ${summary.totalAdd} team${summary.totalAdd === 1 ? '' : 's'} across ${summary.getting} ${summary.getting === 1 ? 'person' : 'people'} · balanced by team strength` + (summary.already ? ` · ${summary.already} already at ${n}` : '')}
            </p>
          </div>
          <div className="sweep-toolbar">
            {phase === 'drawn' && (
              <button className="allocbtn sweep-reroll" onClick={runDraw}><Icon.swap /> Re-roll</button>
            )}
            <div className="sweep-stepper">
              <button type="button" className="allocbtn" aria-label="Fewer teams" disabled={n <= 1 || lockN} onClick={() => changeN(-1)}><span aria-hidden="true">−</span></button>
              <b className="sweep-n-val">{n}</b>
              <button type="button" className="allocbtn" aria-label="More teams" disabled={n >= maxN || lockN} onClick={() => changeN(1)}><Icon.plus /></button>
            </div>
            {phase === 'idle' && (
              <button className="cta sweep-run" disabled={summary.totalAdd === 0} onClick={runDraw}><Icon.ball /> Run sweep</button>
            )}
            {phase === 'revealing' && (
              <button className="cta sweep-run sweep-skip" onClick={skip}>Skip animation</button>
            )}
            {phase === 'drawn' && (
              <button className="cta sweep-run sweep-confirm" onClick={confirm}><Icon.check /> Confirm</button>
            )}
            {phase === 'committing' && (
              <button className="cta sweep-run" disabled><Icon.spinner /> Saving…</button>
            )}
          </div>
        </div>

        <div className="sweepgrid">
          {/* People (left) — one per line, teams tick up */}
          <div className="sweep-col">
            <h4 className="adminsec-h">People <span className="ct">{people.length}</span></h4>
            <div className="sweep-people">
              {peopleSorted.map((p) => {
                const fresh = (live && newTeamsByPerson[p.id]) || []
                const total = (p.teams?.length || 0) + fresh.length
                const full = !live && Math.max(0, n - (p.teams?.length || 0)) === 0
                return (
                  <div className={"sweep-person" + (activeRow?.personId === p.id ? " is-drawing" : "") + (full ? " is-full" : "")} key={p.id}>
                    <PersonAvatar p={p} cls="pav" />
                    <div className="sweep-person-main">
                      <b className="sweep-person-name">{p.name}</b>
                      <div className="sweep-slot">
                        {(p.teams || []).map((tc) => (
                          <span className="t tc-flag sweep-old-flag" key={"o" + tc}><Flag code={tc} w={25} h={18} /></span>
                        ))}
                        {fresh.map((tc) => (
                          <span className="t tc-flag sweep-new-flag in" key={"n" + tc}><Flag code={tc} w={25} h={18} /></span>
                        ))}
                      </div>
                    </div>
                    <div className="sweep-count"><b>{total}</b><small>teams</small></div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Teams (right) — one per line, people names get assigned */}
          <div className="sweep-col">
            <h4 className="adminsec-h">Teams <span className="ct">{teamList.length}</span></h4>
            <div className="sweep-pool">
              {teamList.map((t) => {
                const existing = t.owners || []
                const fresh = (live && newOwnersByTeam[t.code]) || []
                const total = existing.length + fresh.length
                return (
                  <div className={"sweep-pool-team" + (activeRow?.teamCode === t.code ? " is-drawing" : "") + (total > 1 ? " is-multi" : "") + (total === 0 ? " is-empty" : "")} key={t.code}>
                    <Flag code={t.code} w={26} h={18} />
                    <span className="sweep-pool-name">{t.name}</span>
                    <div className="sweep-pool-owners">
                      {existing.map((o) => <OwnerChip key={"e" + o.id} person={byId[o.id] || o} />)}
                      {fresh.map((id, i) => <OwnerChip key={"n" + id + i} person={byId[id]} fresh />)}
                      {total === 0 && <span className="sweep-pool-empty">—</span>}
                    </div>
                    {total > 1 && <span className="sweep-pool-count">×{total}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
