/* ============================================================
   THE SWEEP — shared components
   ============================================================ */
import { useState, useEffect, useRef, useMemo } from "react";
import { SWEEP as S } from "./data.js";
import {
  useSocial, getMe, setMe, isWatching, toggleWatch, watchersOf, toast,
} from "./social.js";

export { useSocial, getMe, setMe, isWatching, toggleWatch, watchersOf };

/* ---- icons ---- */
export const Icon = {
  home:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>,
  cal:     (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>,
  people:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14.6c2.6.2 4.5 2.1 4.5 4.9"/></svg>,
  globe:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 000 18M3 12h18M5 7h14M5 17h14"/></svg>,
  bars:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M5 21V9M12 21V4M19 21v-7"/></svg>,
  back:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M15 5l-7 7 7 7"/></svg>,
  chev:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M9 5l7 7-7 7"/></svg>,
  x:       (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>,
  check:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 12l5 5L20 6"/></svg>,
  share:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="6" cy="12" r="2.4"/><circle cx="17" cy="6" r="2.4"/><circle cx="17" cy="18" r="2.4"/><path d="M8 11l7-4M8 13l7 4"/></svg>,
  filter:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M3 5h18M6 12h12M10 19h4"/></svg>,
  camera:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.4"/></svg>,
  lock:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>,
  shield:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>,
  trash:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>,
  pin:     (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>,
  bolt:    (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>,
  eye:     (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>,
  eyefill: (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="#fff"/></svg>
};

export function WatchBtn({ id, compact }){
  useSocial();
  const on = isWatching(id);
  const n = watchersOf(id).length;
  function click(e){ e.stopPropagation(); const ok = toggleWatch(id); if (ok) toast(on ? "No longer watching" : "You're watching — visible to the group"); }
  return (
    <button className={"watchbtn" + (on?" on":"") + (compact?" compact":"")} onClick={click} title={on?"You're watching":"I'll be watching"} aria-pressed={on}>
      {on ? <Icon.eyefill/> : <Icon.eye/>}
      {n>0 && <span className="wn">{n}</span>}
      {!compact && <span>{on ? "Watching" : "Watch"}</span>}
    </button>
  );
}

export function Flag({ code, w, h, cls }) {
  return <img className={"flag " + (cls||"")} src={S.flag(code, 160)} alt="" style={{ width:w, height:h }} />;
}

/* avatar */
export function Av({ p, size, light }) {
  const s = size || 24;
  if (p && p.avatarPath) {
    return <img className="av" src={p.avatarPath} alt={p.initials || ""} style={{ width:s, height:s, objectFit:"cover", borderColor: light?"#fff":undefined }} />;
  }
  return <span className="av" style={{ background:p.av, width:s, height:s, fontSize:s*0.42, borderColor: light?"#fff":undefined }}>{p.initials}</span>;
}
export function AvStack({ people, size, light, max }) {
  const m = max || 4;
  const shown = people.slice(0, m);
  return (
    <span className="chips" style={{display:"inline-flex"}}>
      {shown.map((p,i)=> <Av key={i} p={p} size={size} light={light} />)}
      {people.length > m && <span className="av" style={{ background:"#5b6f8e", width:size, height:size, fontSize:(size||24)*0.4, borderColor: light?"#fff":undefined }}>+{people.length-m}</span>}
    </span>
  );
}

/* probability bar (hero) */
export function ProbBar({ prob }) {
  return (
    <div className="prob">
      <div className="prob-bar">
        <i className="a" style={{ width: prob.a+"%" }}></i>
        <i className="d" style={{ width: prob.d+"%" }}></i>
        <i className="b" style={{ width: prob.b+"%" }}></i>
      </div>
    </div>
  );
}

/* status pill for a fixture */
export function StatusPill({ f }) {
  if (f.status === "live") return <span className="pill live"><span className="b"></span> Live · {f.minute}'</span>;
  if (f.status === "final") return <span className="pill final">Full time</span>;
  if (f.derby) return <span className="pill derby"><span style={{fontWeight:900}}>⚡</span> Derby</span>;
  return <span className="pill up">Upcoming</span>;
}

/* W/D/L result pill from a team's perspective */
export function resultFor(f, code) {
  if (f.status !== "final") return null;
  const isT1 = f.t1 === code;
  const me = isT1 ? f.score[0] : f.score[1];
  const opp = isT1 ? f.score[1] : f.score[0];
  if (me > opp) return "w"; if (me < opp) return "l"; return "d";
}

/* full match card (home + schedule) */
export function MatchCard({ f, onOpen, onToast }) {
  const t1 = S.team(f.t1), t2 = S.team(f.t2);
  const o = S.ownersForFixture(f);
  const showScore = f.status === "final" || f.status === "live";
  const s1 = f.score ? f.score[0] : null, s2 = f.score ? f.score[1] : null;
  const lead2 = showScore && s2 > s1;
  return (
    <article className={"card" + (f.derby ? " derby":"")} onClick={()=>onOpen && onOpen(f)}>
      <div className="tcbar" style={{ background:`linear-gradient(${t1.color},${t2.color})` }}></div>
      <div className="mc-top">
        <StatusPill f={f} />
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <span className="mc-time">{f.status==="final" ? f.dayLabel : f.timeLabel + " AEST"}</span>
          <WatchBtn id={f.id} compact onToast={onToast} />
        </div>
      </div>
      <div className="mc-grid">
        <div>
          <div className={"row" + (lead2 ? " dim":"")}>
            <Flag code={f.t1} cls="fl" />
            <span className="nm">{t1.name}</span>
            {o.t1.length>0 && <span className="own"><AvStack people={o.t1} size={20} max={3} /></span>}
            {showScore && <span className="sc">{s1}</span>}
          </div>
          <div className={"row" + (showScore && s1 > s2 ? " dim":"")}>
            <Flag code={f.t2} cls="fl" />
            <span className="nm">{t2.name}</span>
            {o.t2.length>0 && <span className="own"><AvStack people={o.t2} size={20} max={3} /></span>}
            {showScore && <span className="sc">{s2}</span>}
          </div>
        </div>
        {!showScore && (
          <div className="winpct">
            <div><div className="wp">{f.prob.a}%</div><small>Win</small></div>
            <div><div className={"wp" + (f.prob.b<f.prob.a?" lo":"")}>{f.prob.b}%</div><small>Win</small></div>
          </div>
        )}
      </div>
      <div className="mc-foot">
        <span className="venue"><Icon.pin style={{width:12,height:12,stroke:"var(--muted)"}}/> <span>{f.venue}</span></span>
        <span className="grp">GROUP {f.group}</span>
      </div>
    </article>
  );
}

/* home header */
export function HomeHeader({ onAdmin }) {
  return (
    <header className="top home-top">
      <div className="brandrow">
        <div className="brand">
          <div className="mark">S</div>
          <div><b>THE SWEEP</b><small>WORLD CUP 2026</small></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div className="tz"><b>Sat 13 Jun</b>Sydney · AEST</div>
          <button onClick={onAdmin} aria-label="Admin" style={{width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}><Icon.lock style={{width:15,height:15,stroke:"#9fb6d6"}}/></button>
        </div>
      </div>
      <button className="idchip dark" style={{marginTop:12,width:"100%"}} onClick={()=>window.__sweepPickMe && window.__sweepPickMe()}>
        <IdentityInner/>
      </button>
    </header>
  );
}

/* page header w/ back */
export function PageHeader({ title, sub, onBack, right, tall }) {
  return (
    <header className={"top page-top" + (tall ? " tall":"")}>
      <div className="phead">
        {onBack && <button className="backbtn" onClick={onBack}><Icon.back/></button>}
        <div style={{minWidth:0, flex:1}}>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
    </header>
  );
}

/* bottom nav */
const TABS = [
  ["home","Today",Icon.home],["schedule","Schedule",Icon.cal],
  ["people","People",Icon.people],["teams","Teams",Icon.globe],["standings","Table",Icon.bars]
];
export function BottomNav({ tab, go }) {
  return (
    <nav className="tabs">
      {TABS.map(([id,label,Ic])=>(
        <button key={id} className={"tab" + (tab===id?" on":"")} onClick={()=>go(id)}>
          <Ic/><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* countdown hook */
export function useCountdown(offsetSec) {
  const target = useRef(Date.now() + offsetSec*1000);
  const [now, setNow] = useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(t); },[]);
  let s = Math.max(0, Math.floor((target.current - now)/1000));
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60;
  const pad=n=>String(n).padStart(2,"0");
  return { hms: pad(h)+":"+pad(m)+":"+pad(x), hm: pad(h)+":"+pad(m), h, m, x };
}

/* desktop: responsive hook + sidebar */
export function useIsDesktop() {
  const q = "(min-width:900px)";
  const [d, setD] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setD(m.matches);
    m.addEventListener ? m.addEventListener("change", h) : m.addListener(h);
    return () => { m.removeEventListener ? m.removeEventListener("change", h) : m.removeListener(h); };
  }, []);
  return d;
}

const SB_NAV = [
  ["home","Today",Icon.home],["schedule","Schedule",Icon.cal],["people","People",Icon.people],
  ["teams","Teams",Icon.globe],["standings","Standings",Icon.bars],["knockouts","Knockouts",Icon.bolt]
];
export function Sidebar({ current, go, onKnock, onAdmin }) {
  const pending = S.photos.filter(p => p.status === "pending").length;
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="mark">S</div>
        <div><b>THE SWEEP</b><small>WORLD CUP 2026</small></div>
      </div>
      <div className="sb-sec">Browse</div>
      <nav className="sb-nav">
        {SB_NAV.map(([id,label,Ic])=>(
          <button key={id} className={"sb-item"+(current===id?" on":"")} onClick={()=> id==="knockouts" ? onKnock() : go(id)}>
            <Ic/><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sb-sec">Admin</div>
      <nav className="sb-nav">
        <button className={"sb-item"+(current==="admin"?" on":"")} onClick={onAdmin}>
          <Icon.lock/><span>Moderation</span>{pending>0 && <span className="badge">{pending}</span>}
        </button>
      </nav>
      <div className="sb-foot">
        <button className="idchip dark" onClick={()=>window.__sweepPickMe && window.__sweepPickMe()}>
          <IdentityInner/>
        </button>
        <div className="dt" style={{marginTop:12}}><b>Sat 13 Jun</b>Sydney · AEST</div>
      </div>
    </aside>
  );
}

/* identity ---------------------------------------------------- */
function IdentityInner(){
  useSocial();
  const me = getMe();
  return (
    <>
      {me
        ? <span className="av" style={{background:me.av,width:26,height:26,border:0,margin:0,fontSize:11}}>{me.initials}</span>
        : <span className="idq">?</span>}
      <span className="idtxt">
        <small>{me ? "You're viewing as" : "Tap to pick"}</small>
        <b>{me ? me.short : "Who are you?"}</b>
      </span>
      <Icon.chev className="idchev"/>
    </>
  );
}
export function IdentityChip(){
  return (
    <button className="idchip" onClick={()=>window.__sweepPickMe && window.__sweepPickMe()}>
      <IdentityInner/>
    </button>
  );
}
export function IdentitySheet({ onClose }){
  useSocial();
  const me = getMe();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"84%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>Who are you?</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          <p style={{fontSize:12.5,color:"var(--muted)",lineHeight:1.45,marginBottom:14}}>Pick yourself so the app can lead with your teams, your watch list and your support. Stays on this device — no account.</p>
          <div className="plist">
            {S.people.map(p=>(
              <div className={"prow"+(me&&me.id===p.id?" mepick":"")} key={p.id} onClick={()=>{ setMe(p.id); toast("You're set as "+p.short); onClose(); }} style={{padding:"9px 12px"}}>
                <span className="pav" style={{background:p.av,width:38,height:38,fontSize:15}}>{p.initials}</span>
                <div className="pi"><b style={{fontSize:16}}>{p.name}</b>
                  <div className="tms">{p.teams.map(tc=><span className="t" key={tc}><img className="flag" src={S.flag(tc,40)} alt=""/>{S.team(tc).name}</span>)}</div></div>
                {me&&me.id===p.id ? <Icon.check className="chev" style={{stroke:"var(--accent)"}}/> : <Icon.chev className="chev"/>}
              </div>
            ))}
          </div>
          {me && <button className="cta ghost" style={{marginTop:14}} onClick={()=>{ setMe(null); toast("Identity cleared"); onClose(); }}>I'm not in the sweep</button>}
        </div>
      </div>
    </div>
  );
}
