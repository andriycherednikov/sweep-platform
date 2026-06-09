/* ============================================================
   THE SWEEP — social store (per-device, localStorage):
   identity + watching + support
   ============================================================ */
import { useState, useEffect } from "react";
import { SWEEP as S } from "./data.js";

const ME_KEY = "sweep.me.v1", WATCH_KEY = "sweep.watchers.v1", SUP_KEY = "sweep.support.v1";
const socialListeners = new Set();
let globalToast = null;
export function setGlobalToast(fn){ globalToast = fn; }
export function toast(msg){ if (globalToast) globalToast(msg); }
function notifySocial(){ socialListeners.forEach(fn=>fn()); }
function loadJSON(k, fb){ try { var v = JSON.parse(localStorage.getItem(k)); return (v==null) ? fb : v; } catch(e){ return fb; } }
function saveJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }

/* identity — default to a named participant so the feature is visible; "none" = explicitly cleared */
let _meRaw = localStorage.getItem(ME_KEY);
let meId = (_meRaw === null) ? "p4" : (_meRaw === "none" ? null : _meRaw);
export function getMe(){ return meId ? S.people.find(p=>p.id===meId) : null; }
export function setMe(id){ meId = id; try { localStorage.setItem(ME_KEY, id || "none"); } catch(e){} notifySocial(); }

/* watchers: { matchId: [personId] } — seeded so the group activity is visible */
const seedWatchers = {};
seedWatchers[S.nextMatch.id] = ["p4","p5","p6","p1","p2"];
if (S.liveMatch) seedWatchers[S.liveMatch.id] = ["p0","p1","p3"];
let watchers = loadJSON(WATCH_KEY, seedWatchers);
export function watchersOf(mid){ return (watchers[mid]||[]).map(id=>S.people.find(p=>p.id===id)).filter(Boolean); }
export function isWatching(mid){ return !!(meId && (watchers[mid]||[]).indexOf(meId) >= 0); }
export function toggleWatch(mid){
  if (!meId){ if (window.__sweepPickMe) window.__sweepPickMe(); return false; }
  var arr = watchers[mid] ? watchers[mid].slice() : [];
  var i = arr.indexOf(meId);
  if (i>=0) arr.splice(i,1); else arr.push(meId);
  watchers = Object.assign({}, watchers, { [mid]: arr });
  saveJSON(WATCH_KEY, watchers); notifySocial(); return true;
}
export function myWatching(){ if (!meId) return []; return Object.keys(watchers).filter(mid=>watchers[mid].indexOf(meId)>=0); }

/* support: { matchId: { personId: teamCode } } */
const seedSupport = {};
seedSupport[S.nextMatch.id] = { p4:"hr", p5:"hr", p1:"hr", p6:"gh", p2:"gh" };
if (S.liveMatch) seedSupport[S.liveMatch.id] = { p0:"ar", p1:"ar", p3:"mx" };
let support = loadJSON(SUP_KEY, seedSupport);
export function supportOf(mid){
  var m = support[mid] || {}, out = {};
  Object.keys(m).forEach(pid=>{ var p=S.people.find(x=>x.id===pid); if(p){ (out[m[pid]]=out[m[pid]]||[]).push(p); } });
  return out;
}
export function mySupport(mid){ return meId ? ((support[mid]||{})[meId] || null) : null; }
export function setSupport(mid, code){
  if (!meId){ if (window.__sweepPickMe) window.__sweepPickMe(); return; }
  var m = Object.assign({}, support[mid] || {});
  if (m[meId] === code) delete m[meId]; else m[meId] = code;
  support = Object.assign({}, support, { [mid]: m });
  saveJSON(SUP_KEY, support); notifySocial();
}

export function useSocial(){
  const [,force] = useState(0);
  useEffect(()=>{ const fn=()=>force(x=>x+1); socialListeners.add(fn); return ()=>socialListeners.delete(fn); },[]);
  return { me: getMe() };
}
