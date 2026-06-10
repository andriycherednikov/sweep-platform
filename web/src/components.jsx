/* ============================================================
   THE SWEEP — shared components
   ============================================================ */
import { useState, useEffect, useRef, useMemo } from "react";
import { SWEEP as S } from "./data.js";
import {
  useSocial, getMe, setMe, isWatching, toggleWatch, watchersOf, toast,
  supportOf, mySupport, setSupport,
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
  search:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>,
  eyefill: (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="#fff"/></svg>,
  thumb:   (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M2 9.5h3.5V21H2zM21.6 9.2A2 2 0 0020 8.4h-5.1l.77-3.7.02-.32a1.5 1.5 0 00-.44-1.06L14.4 2.5 8.2 8.7a2 2 0 00-.6 1.4V19a2 2 0 002 2h7.3a2 2 0 001.86-1.27l2.27-6.3a2 2 0 00.07-.5V11a2 2 0 00-.5-1.8z"/></svg>,
  star:    (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 21.2l1.4-6.8L2.2 9.8l6.9-.7z"/></svg>
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
/* person avatar for the bigger chips (.pav / .av) — renders the profile image when present */
export function PersonAvatar({ p, cls = "pav", style }) {
  if (!p) return null;
  if (p.avatarPath) return <img className={cls} src={p.avatarPath} alt={p.initials || ""} style={{ objectFit: "cover", ...style }} />;
  return <span className={cls} style={{ background: p.av, ...style }}>{p.initials}</span>;
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
  // last segment fills the remainder so the bar always reaches the end (no sliver gap)
  const a = prob.a || 0, d = prob.d || 0, b = Math.max(0, 100 - a - d);
  return (
    <div className="prob">
      <div className="prob-bar">
        <i className="a" style={{ width: a+"%" }}></i>
        <i className="d" style={{ width: d+"%" }}></i>
        <i className="b" style={{ width: b+"%" }}></i>
      </div>
    </div>
  );
}

/* status pill for a fixture */
export function StatusPill({ f }) {
  if (f.status === "live") return <span className="pill live"><span className="b"></span> Live · {f.minute}'</span>;
  if (f.status === "final") return <span className="pill final">Full time</span>;
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

/* crowd pick — community sentiment on who wins (distinct from the official Win %).
   Reuses the support store: one call per viewer per match, tap to set/clear. */
export function CrowdPick({ f, onToast, light, locked }) {
  useSocial();
  const t1 = S.team(f.t1), t2 = S.team(f.t2);
  const sup = supportOf(f.id);
  const mine = mySupport(f.id);
  const c1 = (sup[f.t1]||[]).length, c2 = (sup[f.t2]||[]).length;
  const total = c1 + c2;
  // once a match starts, calls lock — nothing to show if nobody called it
  if (locked && total === 0) return null;
  const call = (code, name) => (e) => {
    e.stopPropagation();
    if (locked) return;
    const on = mine===code;
    setSupport(f.id, code);
    if (onToast) onToast(on ? "Call removed" : "You're calling "+name+" 👍");
  };

  // teams sit side by side (hero + horizontal cards); thumbs flank a split bar
  const w1 = total ? (c1/total*100) : 50;
  return (
    <div className={"crowd"+(light?" light":"")+(locked?" locked":"")} onClick={e=>e.stopPropagation()}>
      <span className="crowd-lbl">Who'll win?{locked ? " · locked" : (!mine ? " · tap to vote" : "")}</span>
      <div className="crowd-row">
        <button type="button" disabled={locked} className={"cpick"+(mine===f.t1?" on":"")} aria-pressed={mine===f.t1}
          aria-label={"Call "+t1.name} title={locked ? t1.name : "Call "+t1.name} onClick={call(f.t1,t1.name)}>
          <Icon.thumb/><b>{c1}</b>
        </button>
        <div className={"cbar"+(total===0?" novote":"")} aria-hidden="true">
          {total > 0 && <>
            <i style={{width:w1+"%", background:t1.color}}></i>
            <i style={{width:(100-w1)+"%", background:t2.color}}></i>
          </>}
        </div>
        <button type="button" disabled={locked} className={"cpick"+(mine===f.t2?" on":"")} aria-pressed={mine===f.t2}
          aria-label={"Call "+t2.name} title={locked ? t2.name : "Call "+t2.name} onClick={call(f.t2,t2.name)}>
          <Icon.thumb/><b>{c2}</b>
        </button>
      </div>
      {mine
        ? <div className="crowd-note picked"><Icon.check/> {locked ? "You called " : "Your call: "}{S.team(mine).name}</div>
        : !locked && <div className="crowd-note">Tap a team to call the winner</div>}
    </div>
  );
}

/* full match card (home + schedule) */
export function MatchCard({ f, onOpen, onToast }) {
  useSocial();
  const me = getMe();
  const myTeam = !!me && (me.teams.indexOf(f.t1)>=0 || me.teams.indexOf(f.t2)>=0);
  const mine = myTeam || isWatching(f.id); // highlight: your team plays, or you're watching
  const t1 = S.team(f.t1), t2 = S.team(f.t2);
  const o = S.ownersForFixture(f);
  const showScore = f.status === "final" || f.status === "live";
  const s1 = f.score ? f.score[0] : null, s2 = f.score ? f.score[1] : null;
  return (
    <article className={"card" + (mine ? " mine":"")} onClick={()=>onOpen && onOpen(f)}>
      <div className="tcbar" style={{ background:`linear-gradient(${t1.color},${t2.color})` }}></div>
      <div className="mc-top">
        <div className="mc-status">
          <StatusPill f={f} />
          {myTeam && <span className="mine-tag"><Icon.star/> Your team</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <span className="mc-time">{f.status==="final" ? f.dayLabel : (f.dayKey!==S.todayKey ? f.dayLabel+" · " : "") + f.timeLabel + " AEST"}</span>
          <WatchBtn id={f.id} compact onToast={onToast} />
        </div>
      </div>
      <div className="mc-h">
        <div className={"mc-h-team" + (showScore && s1 < s2 ? " dim":"")}>
          <Flag code={f.t1} w={34} h={25} />
          <span className="nm">{t1.name}</span>
          <div className="mc-h-sub">
            {o.t1.length>0 && <AvStack people={o.t1} size={28} max={3} />}
            {!showScore && f.hasOdds && <span className="mc-h-wp">{f.prob.a}<i>%</i></span>}
          </div>
        </div>
        <div className="mc-h-mid">
          {showScore
            ? <span className="mc-sc">{s1}<i>–</i>{s2}</span>
            : <span className="mc-vs">VS</span>}
        </div>
        <div className={"mc-h-team right" + (showScore && s2 < s1 ? " dim":"")}>
          <Flag code={f.t2} w={34} h={25} />
          <span className="nm">{t2.name}</span>
          <div className="mc-h-sub">
            {!showScore && f.hasOdds && <span className="mc-h-wp">{f.prob.b}<i>%</i></span>}
            {o.t2.length>0 && <AvStack people={o.t2} size={28} max={3} />}
          </div>
        </div>
      </div>
      <CrowdPick f={f} onToast={onToast} locked={f.status !== "upcoming"} />
      <div className="mc-foot">
        <span className="venue"><Icon.pin style={{width:12,height:12,stroke:"var(--muted)"}}/> <span>{f.venue}{f.city ? " · "+f.city : ""}</span></span>
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
          <div className="mark"><img src="/trophy.png" alt="The Sweep"/></div>
          <div><b>THE SWEEP</b><small>WORLD CUP 2026</small></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div className="tz"><b>Sat 13 Jun</b>Sydney · AEST</div>
          <button onClick={onAdmin} aria-label="Admin" style={{width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}><Icon.lock style={{width:15,height:15,stroke:"#9fb6d6"}}/></button>
        </div>
      </div>
      <button className="idchip dark" style={{marginTop:20,width:"100%"}} onClick={()=>window.__sweepPickMe && window.__sweepPickMe()}>
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
  const pad=n=>String(n).padStart(2,"0");
  const totalH=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60;
  const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600);
  const hms = pad(totalH)+":"+pad(m)+":"+pad(x);
  // when more than a day out, show days so it doesn't read e.g. "96:00:00"
  const display = d>0 ? d+"d "+pad(h)+":"+pad(m)+":"+pad(x) : hms;
  const unit = d>0 ? "DAYS · HRS · MIN · SEC" : "HRS · MIN · SEC";
  return { hms, hm: pad(totalH)+":"+pad(m), display, unit, d, h: totalH, m, x, s };
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
        <div className="mark"><img src="/trophy.png" alt="The Sweep"/></div>
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

/* reusable search box for picker sheets ----------------------- */
export function SearchInput({ value, onChange, placeholder, autoFocus }){
  return (
    <div style={{position:"relative",marginBottom:12}}>
      <Icon.search style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",width:16,height:16,stroke:"var(--muted2)",pointerEvents:"none"}}/>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={e=>onChange(e.target.value)}
        placeholder={placeholder}
        style={{width:"100%",boxSizing:"border-box",padding:"11px 12px 11px 36px",borderRadius:11,border:"1.5px solid var(--line)",background:"var(--card)",fontSize:15,color:"var(--navy)",outline:"none"}}
      />
      {value && <button onClick={()=>onChange("")} aria-label="Clear" style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",width:24,height:24,border:0,background:"transparent",cursor:"pointer",color:"var(--muted2)"}}><Icon.x style={{width:14,height:14}}/></button>}
    </div>
  );
}

/* identity ---------------------------------------------------- */
function IdentityInner(){
  useSocial();
  const me = getMe();
  return (
    <>
      {me
        ? <PersonAvatar p={me} cls="av" style={{width:42,height:42,border:0,margin:0,fontSize:16}}/>
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
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const people = ql
    ? S.people.filter(p => p.name.toLowerCase().includes(ql) || p.teams.some(tc => (S.team(tc)?.name || "").toLowerCase().includes(ql)))
    : S.people;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"84%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>Who are you?</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          <p style={{fontSize:12.5,color:"var(--muted)",lineHeight:1.45,marginBottom:12}}>Pick yourself so the app can lead with your teams, your watch list and your support. Stays on this device — no account.</p>
          <SearchInput value={q} onChange={setQ} placeholder="Search by name or team…" autoFocus />
          {people.length===0 && <p style={{fontSize:13,color:"var(--muted2)",textAlign:"center",padding:"18px 0"}}>No one matches “{q}”.</p>}
          <div className="plist">
            {people.map(p=>(
              <div className={"prow"+(me&&me.id===p.id?" mepick":"")} key={p.id} onClick={()=>{ setMe(p.id); toast("You're set as "+p.short); onClose(); }} style={{padding:"9px 12px"}}>
                <PersonAvatar p={p} cls="pav" style={{width:57,height:57,fontSize:22}}/>
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
