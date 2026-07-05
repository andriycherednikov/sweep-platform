/* ============================================================
   THE SWEEP — social store: identity (localStorage) +
   support (server-backed, hydrated via setSocialData,
   optimistic writes reconciled by SSE).
   ============================================================ */
import { useState, useEffect } from "react";
import { SWEEP as S } from "./data.js";
import { postSupport } from "./api/client.js";
import { trackEvent } from "./lib/analytics.js";

export const DRAW = 'DRAW';

const LEGACY_ME_KEY = "sweep.me.v1";              // pre-multi-sweep device-global pointer
const socialListeners = new Set();
let globalToast = null;
export function setGlobalToast(fn){ globalToast = fn; }
export function toast(msg){ if (globalToast) globalToast(msg); }
function notifySocial(){ socialListeners.forEach(fn=>fn()); }

let currentSweepId = "default";
const meKey = () => `sweep.me.v1.${currentSweepId}`;
const readMe = () => {
  const raw = localStorage.getItem(meKey());
  return (raw === null || raw === "none") ? null : raw;
};

/* one-time migration: copy a legacy sweep.me.v1 pick to sweep.me.v1.default
   (without clobbering an already-migrated default), then re-key identity. */
export function setCurrentSweepId(id){
  currentSweepId = id || "default";
  if (currentSweepId === "default") {
    const legacy = localStorage.getItem(LEGACY_ME_KEY);
    if (legacy !== null && localStorage.getItem("sweep.me.v1.default") === null) {
      try { localStorage.setItem("sweep.me.v1.default", legacy); } catch(e){}
    }
  }
  meId = readMe();
  notifySocial();
}

/* identity — nobody is auto-selected; "none" = explicitly cleared */
let meId = readMe();
export function getMe(){ return meId ? S.people.find(p=>p.id===meId) : null; }
export function setMe(id){ meId = id; try { localStorage.setItem(meKey(), id || "none"); } catch(e){} notifySocial(); }

/* server-backed state, hydrated by the ['social'] query + kept live by SSE */
let support = {};           // { fixtureId: { personId: teamCode } }
export function setSocialData(server){
  support  = (server && server.support) ? server.support : {};
  notifySocial();
}

export function supportOf(mid){
  const m = support[mid] || {}, out = {};
  Object.keys(m).forEach(pid=>{ const p=S.people.find(x=>x.id===pid); if(p){ (out[m[pid]]=out[m[pid]]||[]).push(p); } });
  return out;
}
export function mySupport(mid){ return meId ? ((support[mid]||{})[meId] || null) : null; }
export function setSupport(mid, code){
  if (!meId){ if (window.__sweepPickMe) window.__sweepPickMe(); return; }
  if (S.readOnly) { toast("Sweep is read-only"); return; }
  const prev = support;
  const m = Object.assign({}, support[mid] || {});
  if (m[meId] === code) { delete m[meId]; }
  else {
    m[meId] = code;
    const f = S.fixture(mid);
    const pick = !f            ? null
               : code === DRAW ? "draw"
               : code === f.t1 ? "home"
               :                 "away";
    if (pick) trackEvent("vote_cast", { pick, match_id: mid });
  }
  support = Object.assign({}, support, { [mid]: m });
  notifySocial();
  postSupport(mid, meId, code).catch(()=>{ support = prev; notifySocial(); toast("Couldn't update — try again"); });
}

/* prediction accuracy leaderboard — how many finished matches each person
   called correctly (winner picked via the crowd call). A DRAW pick wins on a level final. */
export function predictionLeaderboard(limit = 4){
  const stats = {};
  for (const f of S.fixtures){
    if (f.status !== "final" || !f.score) continue;
    const [a, b] = f.score;
    // winnerCode (incl. penalty shootouts; 'DRAW' === DRAW sentinel) is the actual result;
    // score compare only as the no-winnerCode fallback. Keeps grading in step with coin payouts.
    const result = f.winnerCode || (a > b ? f.t1 : b > a ? f.t2 : (S.competition.hasDraws ? DRAW : null));
    const picks = support[f.id];
    if (!picks) continue;
    for (const pid of Object.keys(picks)){
      const s = stats[pid] || (stats[pid] = { correct: 0, total: 0 });
      s.total++;
      if (picks[pid] === result) s.correct++;
    }
  }
  return Object.keys(stats)
    .map(pid => ({ person: S.people.find(p => p.id === pid), correct: stats[pid].correct, total: stats[pid].total }))
    .filter(x => x.person)
    .sort((a, b) => b.correct - a.correct || (b.correct / b.total) - (a.correct / a.total))
    .slice(0, limit);
}

/* a single person's prediction history: every fixture they picked, with a verdict.
   verdict: 'correct' | 'wrong' for finals (winner team, or DRAW on a level final),
   null for upcoming/live (unresolved). Sorted by kickoff ascending. */
export function predictionsOf(personId){
  const out = [];
  for (const f of S.fixtures){
    const pick = (support[f.id] || {})[personId];
    if (!pick) continue;
    let verdict = null;
    if (f.status === "final" && f.score){
      const [a, b] = f.score;
      const result = f.winnerCode || (a > b ? f.t1 : b > a ? f.t2 : (S.competition.hasDraws ? DRAW : null));
      verdict = pick === result ? "correct" : "wrong";
    }
    out.push({ f, pick, verdict });
  }
  return out.sort((x, y) => x.f.ko - y.f.ko);
}

/* resolved-only accuracy for the header tile: { correct, total } over finals. */
export function predictionAccuracy(personId){
  // verdict is non-null exactly for resolved finals (final + score), so it is the
  // resolved-set filter and the correctness check in one.
  const resolved = predictionsOf(personId).filter(p => p.verdict !== null);
  return { correct: resolved.filter(p => p.verdict === "correct").length, total: resolved.length };
}

export function useSocial(){
  const [,force] = useState(0);
  useEffect(()=>{ const fn=()=>force(x=>x+1); socialListeners.add(fn); return ()=>socialListeners.delete(fn); },[]);
  return { me: getMe() };
}
