/* ============================================================
   THE SWEEP — main screens: Home, Schedule, Standings, Knockouts
   ============================================================ */
import { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { SWEEP as S } from "./data.js";
import {
  Icon, Flag, Av, AvStack, PersonAvatar, ProbBar, MatchCard, CrowdPick, HomeHeader, AppHeader, PageHeader,
  SearchInput, useCountdown, useIsDesktop, useScrolled, ScoreCover, PersonTeams, PenScore,
} from "./components.jsx";
import { useSocial, getMe, toast, predictionLeaderboard } from "./social.js";
import { winnerCodeOf, isShootoutKick } from "./lib/assemble.js";
import { liveLabel } from "./lib/format.js";
import { useCoins, coinsLeaderboard, canWager } from "./coins.js";
import { useSpoiler, spoilerHidden } from "./spoiler.js";

// Latest-scores summary from a finished fixture's events: goal scorers (surnames; an
// own goal is credited to the team it benefited, tagged "(OG)") and card counts per side.
function resultSummary(f) {
  const ev = (f.events || []).filter(e => !isShootoutKick(f, e));
  const isOG = (e) => /own goal/i.test(e.detail || "");
  const credited = (e) => (isOG(e) ? (e.teamCode === f.t1 ? f.t2 : f.t1) : e.teamCode);
  const surname = (n) => { const p = (n || "").trim().split(/\s+/); return p[p.length - 1] || (n || ""); };
  const scorers = (team) => {
    const seen = new Map();
    for (const e of ev) if (e.type === "goal" && credited(e) === team) {
      const key = surname(e.player) + (isOG(e) ? " (OG)" : "");
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  };
  const cards = (team, color) => ev.filter((e) => e.type === "card" && e.teamCode === team && e.card === color).length;
  return {
    home: { scorers: scorers(f.t1), yellow: cards(f.t1, "yellow"), red: cards(f.t1, "red") },
    away: { scorers: scorers(f.t2), yellow: cards(f.t2, "yellow"), red: cards(f.t2, "red") },
    any: ev.length > 0,
  };
}
// Draw one chip per card (4 yellows → 4 yellow chips), titled for a11y/at-a-glance count.
function CardChips({ red, n }) {
  if (!n) return null;
  return (
    <span className="res-cardset" title={`${n} ${red ? "red" : "yellow"} ${n === 1 ? "card" : "cards"}`}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={"res-card" + (red ? " red" : "")} />)}
    </span>
  );
}

/* ---------------- HOME ---------------- */
export function HomeScreen({ go, openMatch, openTeam, openPerson, openPhoto, onAdmin, onSweeps }) {
  // a live match stays front-and-center in the hero until it's over; otherwise the soonest
  // kickoff that's still in the future. derived from Date.now() each render (the countdown
  // re-renders every second) so when a match kicks off, the hero rolls to the next one's
  // countdown instead of sitting at 00:00:00 until a refresh. falls back to nextMatch.
  // GRACE: a match whose advertised kickoff just passed stays the hero (counting into
  // negative time) for KICKOFF_GRACE_SEC, so a slightly-late start doesn't prematurely roll
  // to the next match before the worker flips its status to "live".
  const KICKOFF_GRACE_SEC = 20 * 60;
  const next = S.liveMatch
    || S.fixtures.find(f => f.status === "upcoming" && (f.ko.getTime() - Date.now()) / 1000 > -KICKOFF_GRACE_SEC)
    || S.nextMatch;
  const live = next.status === "live";
  const t1 = S.team(next.t1), t2 = S.team(next.t2);
  const o = S.ownersForFixture(next);
  const cd = useCountdown(Math.max(-KICKOFF_GRACE_SEC, Math.floor((next.ko.getTime() - Date.now()) / 1000)));

  useSocial(); // re-render on identity / support changes
  useSpoiler();
  const me = getMe();
  const isDesktop = useIsDesktop(); // mobile is people-centric: stats go above Next games

  const order = { live:0, upcoming:1, final:2 };
  // soonest games, in natural order — your games are highlighted inline (not floated to the top)
  const nextMatches = S.fixtures
    .filter(f => f.status !== "final" && f.id !== next.id)
    .sort((a,b)=> (order[a.status]-order[b.status]) || (a.ko-b.ko))
    .slice(0,16);
  const results = S.fixtures.filter(f => f.status === "final").sort((a,b)=> b.ko - a.ko).slice(0,6);

  // top 4 people by wins across finished matches (winnerCodeOf → counts knockout & shootout wins)
  const finals = S.fixtures.filter(f => f.status === "final" && f.score);
  const topWinners = S.people
    .map(p => ({ person: p, wins: finals.reduce((n,f)=> n + (p.teams.indexOf(winnerCodeOf(f))>=0 ? 1 : 0), 0) }))
    .filter(r => r.wins > 0)
    .sort((a,b)=> b.wins - a.wins)
    .slice(0,4);
  const accurate = predictionLeaderboard(4); // top predictors by correct crowd calls
  // top Yowie Dollars balances — adults only, and only logged-in adults can see it
  useCoins();
  const showWagers = canWager();
  const topWagers = showWagers
    ? coinsLeaderboard(Infinity).filter(r => r.person?.adult !== false).slice(0, 4)
    : [];

  // sticky header shrink: GRADUAL, scroll-linked. The Home header is the only one
  // rendered INSIDE its scroll container, so collapsing it changes scrollHeight. We
  // (a) shrink it gradually (progress 0..1) and (b) add a bottom spacer equal to the
  // EXACT px the header has collapsed, so scrollHeight stays constant — the browser
  // never force-clamps scrollTop, which is what used to make the header oscillate
  // ("spaz") when there wasn't much content on screen.
  const scrollRef = useRef(null);
  const { progress, scrolled, onScroll } = useScrolled(scrollRef);
  const headRef = useRef(null);
  const expandedH = useRef(0);
  const progressRef = useRef(0);
  const [collapsePx, setCollapsePx] = useState(0);
  const measureCollapse = useCallback(() => {
    const el = headRef.current;
    if (!el) return;
    // capture the expanded baseline only while at the top (progress 0) so a
    // mid-shrink measurement can't poison it
    if (progressRef.current === 0) expandedH.current = el.offsetHeight;
    const delta = Math.max(0, expandedH.current - el.offsetHeight);
    setCollapsePx((prev) => (prev === delta ? prev : delta));
  }, []);
  // sync (pre-paint) measure on every progress change → spacer tracks the header in
  // the same frame, no flash and no one-frame clamp
  useLayoutEffect(() => { progressRef.current = progress; measureCollapse(); }, [progress, measureCollapse]);
  // re-measure the expanded baseline on resize / async content (countdown, login,
  // late data) — set up once, reads the latest progress via the ref
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureCollapse());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureCollapse]);

  const approved = S.photos.filter(p=>p.status==="approved" && p.kind==="fan");
  const [pi, setPi] = useState(0);
  // auto-advance, but pause on manual control (swipe / dot) and resume after a
  // short idle timeout
  const [paused, setPaused] = useState(false);
  useEffect(()=>{ if(approved.length===0 || paused) return; const t=setInterval(()=>setPi(x=>(x+1)%approved.length), 6000); return ()=>clearInterval(t); },[approved.length, paused]);
  const resumeRef = useRef(null);
  useEffect(()=>()=>{ if(resumeRef.current) clearTimeout(resumeRef.current); },[]);
  const pauseAuto = () => { setPaused(true); if(resumeRef.current) clearTimeout(resumeRef.current); resumeRef.current = setTimeout(()=>setPaused(false), 10000); };
  const photo = approved[pi];
  const fanTouch = useRef({ x: 0, moved: false });
  const fanGo = (delta) => { pauseAuto(); setPi(p => (p + delta + approved.length) % approved.length); };
  const onFanTouchStart = (e) => { fanTouch.current = { x: e.touches[0].clientX, moved: false }; };
  const onFanTouchMove = (e) => { if (Math.abs(e.touches[0].clientX - fanTouch.current.x) > 8) fanTouch.current.moved = true; };
  const onFanTouchEnd = (e) => { const dx = e.changedTouches[0].clientX - fanTouch.current.x; if (Math.abs(dx) > 40) fanGo(dx < 0 ? 1 : -1); };
  // a swipe shouldn't also open the lightbox
  const onFanClick = () => { if (fanTouch.current.moved) { fanTouch.current.moved = false; return; } openPhoto(photo); };
  const photoFx = photo ? S.fixture(photo.fixtureId) : null;

  // people-centric stat panels — split into individual blocks so mobile can interleave them
  // (results → community → best predictions → most wins …) while desktop keeps them grouped in the sidebar.
  const panelMostWins = (
    topWinners.length>0 && <>
        <div className="sec-h"><h2>Most wins</h2><span className="lnk" onClick={()=>go("people")}>People →</span></div>
        <div className="ranklist">{topWinners.map((r,i)=>(
          <div className="rankrow" key={r.person.id} onClick={()=>openPerson(r.person)}>
            <span className="rk">{i+1}</span>
            <PersonAvatar p={r.person} cls="av" style={{width:30,height:30,border:0,margin:0,fontSize:12}}/>
            <span className="rname">{r.person.name}</span>
            <b className="rval">{r.wins}<i>W</i></b>
          </div>
        ))}</div>
      </>
  );

  const panelResults = (
      results.length>0 && <>
        <div className="sec-h"><h2>Latest scores</h2><span className="lnk" onClick={()=>go("schedule")}>All →</span></div>
        <div className="sidescores">{results.map(f=>{
          const ta=S.team(f.t1), tb=S.team(f.t2);
          const sum=resultSummary(f);
          return (
            <div className="res" key={f.id} onClick={()=>openMatch(f)}>
              <div className="res-main">
                <div className="rt">
                  <Flag code={f.t1} w={22} h={16}/><span className="nm">{ta.name}</span>
                  {(sum.home.yellow || sum.home.red) ? <span className="res-cards"><CardChips n={sum.home.yellow}/><CardChips red n={sum.home.red}/></span> : null}
                </div>
                {spoilerHidden(f) ? <ScoreCover f={f}/> : (
                  <span className="rscore" style={{ minWidth: 60, textAlign: "center", whiteSpace: "nowrap" }}>
                    {f.score[0]}<PenScore pen={f.penScore} side={0} /> – {f.score[1]}<PenScore pen={f.penScore} side={1} />
                  </span>
                )}
                <div className="rt" style={{justifyContent:"flex-end"}}>
                  {(sum.away.yellow || sum.away.red) ? <span className="res-cards"><CardChips red n={sum.away.red}/><CardChips n={sum.away.yellow}/></span> : null}
                  <span className="nm">{tb.name}</span><Flag code={f.t2} w={22} h={16}/>
                </div>
                <span className="ft">FT</span>
              </div>
              {!spoilerHidden(f) && (sum.home.scorers.length || sum.away.scorers.length) ? (
                <div className="res-extra">
                  <div className="res-side">
                    {sum.home.scorers.length>0 && <span className="res-scorers">{sum.home.scorers.join(", ")}</span>}
                  </div>
                  <div className="res-side r">
                    {sum.away.scorers.length>0 && <span className="res-scorers">{sum.away.scorers.join(", ")}</span>}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}</div>
      </>
  );

  const panelBestPredictions = (
      accurate.length>0 && <>
        <div className="sec-h"><h2>Best predictions</h2><span className="lnk" onClick={()=>go("people",{view:"predictions"})}>People →</span></div>
        <div className="ranklist">{accurate.map((r,i)=>(
          <div className="rankrow" key={r.person.id} onClick={()=>openPerson(r.person)}>
            <span className="rk">{i+1}</span>
            <PersonAvatar p={r.person} cls="av" style={{width:30,height:30,border:0,margin:0,fontSize:12}}/>
            <span className="rname">{r.person.name}</span>
            <b className="rval">{r.correct}</b>
          </div>
        ))}</div>
      </>
  );

  const panelTopWagering = (
      showWagers && topWagers.length>0 && <>
        <div className="sec-h"><h2>Top wagering</h2><span className="lnk" onClick={()=>go("people",{view:"coins"})}>People →</span></div>
        <div className="ranklist">{topWagers.map((r,i)=>(
          <div className="rankrow" key={r.person.id} onClick={()=>openPerson(r.person)}>
            <span className="rk">{i+1}</span>
            <PersonAvatar p={r.person} cls="av" style={{width:30,height:30,border:0,margin:0,fontSize:12}}/>
            <span className="rname">{r.person.name}</span>
            <b className="rval rval-coin"><Icon.coin/>{r.balance.toLocaleString()}</b>
          </div>
        ))}</div>
      </>
  );

  const nextGames = (
    <>
      <div className="sec-h"><h2>Next games</h2><span className="lnk" onClick={()=>go("schedule")}>Full schedule →</span></div>
      <div className="mgrid">{nextMatches.map(f=> <MatchCard key={f.id} f={f} onOpen={openMatch} />)}</div>
    </>
  );

  const community = (
    <>
      <div className="sec-h"><h2>From the community</h2><span className="lnk" onClick={()=>go("upload")}>Add yours →</span></div>
      {photo ? <>
      <div className="fan" onClick={onFanClick} onTouchStart={onFanTouchStart} onTouchMove={onFanTouchMove} onTouchEnd={onFanTouchEnd}>
        {photo.src ? <img className="ph" src={photo.src} alt={photo.caption||"Fan photo"} loading="lazy"/> : <div className="ph"><span>FAN PHOTO</span></div>}
        {photoFx && <div className="badge"><Flag code={photoFx.t1} w={20} h={15} /><Flag code={photoFx.t2} w={20} h={15} /><span>{S.team(photoFx.t1).name} v {S.team(photoFx.t2).name}</span></div>}
        <div className="cap"><b>{photo.caption}</b><small>Posted by {photo.uploader}</small></div>
      </div>
      <div className="dots">{approved.map((_,i)=><i key={i} className={i===pi?"on":""} onClick={()=>{pauseAuto();setPi(i);}}></i>)}</div>
      </> : <div className="fan empty" onClick={()=>go("upload")}><div className="ph"><span>No fan photos yet</span></div><div className="cap"><small>Be the first — tap to add yours.</small></div></div>}
    </>
  );

  return (
    <div className="scroll pad screen-anim" ref={scrollRef} onScroll={onScroll}>
      <HomeHeader onAdmin={onAdmin} go={go} onSweeps={onSweeps} scrolled={scrolled} progress={progress} scrollRef={scrollRef} headRef={headRef}/>

      {/* hero next match — tap the banner to open the match; inner taps keep their own action */}
      <section className="hero" onClick={()=>openMatch(next)} style={{cursor:"pointer"}}>
        <div className="hero-top">
          <span className="derby-tag" style={{background: live ? "var(--live)" : "#5b6f8e"}}>{live ? "● Live now" : "Next match"}</span>
          <span className="hero-when">{live ? "In play" : cd.s < 0 ? "Kicking off" : "Kicks off in"}</span>
        </div>
        <div className="match-line">
          <div className="team" onClick={(e)=>{e.stopPropagation();openTeam(next.t1);}}>
            <Flag code={next.t1} w={46} h={34} />
            <span className="nm">{t1.name.toUpperCase()}</span>
          </div>
          <div className="vs-cd">
            {live
              ? <>{spoilerHidden(next) ? <ScoreCover f={next} dark/> : <span className="cd">{next.score[0]}<PenScore pen={next.penScore} side={0} />{next.penScore ? " – " : "–"}{next.score[1]}<PenScore pen={next.penScore} side={1} /></span>}<span className="cdl">{[liveLabel(next), "LIVE"].filter(Boolean).join(" · ")}</span></>
              : <><span className="cd">{cd.display}</span><span className="cdl">{cd.unit}</span></>}
          </div>
          <div className="team" onClick={(e)=>{e.stopPropagation();openTeam(next.t2);}}>
            <Flag code={next.t2} w={46} h={34} />
            <span className="nm">{t2.name.toUpperCase()}</span>
          </div>
        </div>
        {!live && next.hasOdds && (!S.competition.hasDraws || next.stage === "knockout" ? <>
        {/* elimination match: two-way "to progress" odds, no draw */}
        <ProbBar prob2={next.prob2} />
        <div className="prob-key">
          <span><b>{next.prob2.pa}%</b> {next.t1.slice(0,3).toUpperCase()}</span>
          <span>{next.t2.slice(0,3).toUpperCase()} <b>{next.prob2.pb}%</b></span>
        </div>
        </> : <>
        <ProbBar prob3={next.prob3} />
        <div className="prob-key">
          <span><b>{next.prob3.pa}%</b> {next.t1.slice(0,3).toUpperCase()}</span>
          <span><b>{next.prob3.pd}%</b> DRAW</span>
          <span>{next.t2.slice(0,3).toUpperCase()} <b>{next.prob3.pb}%</b></span>
        </div>
        </>)}
        <div onClick={(e)=>e.stopPropagation()}>
          <CrowdPick f={next} onToast={toast} light locked={next.status !== "upcoming"} />
        </div>
        <div className="hero-owners">
          <div className="ostack">
            <div className="lbl">{t1.name} · owners</div>
            <AvStack people={o.t1} size={32} light max={4}/>
            <div className="owner-names">{o.t1.map(p=>p.short).join(" · ")}</div>
          </div>
          <div className="ostack">
            <div className="lbl">{t2.name} · owners</div>
            <AvStack people={o.t2} size={32} light max={4}/>
            <div className="owner-names">{o.t2.map(p=>p.short).join(" · ")}</div>
          </div>
        </div>
      </section>

      <div className="wrap">
       <div className="deskhome">
        {isDesktop ? <>
        <div className="deskhome-main">
        {nextGames}
        </div>

        <div className="deskhome-side">
        {panelResults}
        {community}
        {panelBestPredictions}
        {panelMostWins}
        {panelTopWagering}
        </div>
        </> : (
        // mobile order: latest scores → community → best predictions → most wins → next games → wagering
        <div className="deskhome-main">
        {panelResults}
        {community}
        {panelBestPredictions}
        {panelMostWins}
        {nextGames}
        {panelTopWagering}
        </div>
        )}
       </div>
      </div>
      {/* compensating spacer: keeps scrollHeight constant as the header collapses,
          so the shrink can't yank scrollTop back and oscillate. Mobile only —
          desktop hides the in-flow header. */}
      {!isDesktop && <div className="home-shrink-spacer" aria-hidden="true" style={{ height: collapsePx }} />}
    </div>
  );
}

/* ---------------- SCHEDULE ---------------- */
export function ScheduleScreen({ go, openMatch, openPerson }) {
  const [person, setPerson] = useState(null);
  const [team, setTeam] = useState(null);
  const [pick, setPick] = useState(null); // 'person' | 'team'

  let list = S.fixtures;
  if (person) list = list.filter(f => person.teams.indexOf(f.t1)>=0 || person.teams.indexOf(f.t2)>=0);
  if (team) list = list.filter(f => f.t1===team || f.t2===team);

  // group by day (fixtures arrive in chronological order, so dayKeys do too)
  const days = [];
  const byDay = {};
  list.forEach(f=>{ if(!byDay[f.dayKey]){ byDay[f.dayKey]=[]; days.push(f.dayKey);} byDay[f.dayKey].push(f); });

  // scroll target: today if it has matches, else the first day after today
  const todayKey = S.todayKey;
  const scrollKey = byDay[todayKey] ? todayKey : (days.find(dk => dk > todayKey) || null);

  // on first load (once data is present), bring that day to the top of the list
  const scrollRef = useRef(null);
  const targetRef = useRef(null);
  const didScroll = useRef(false);
  const { scrolled, onScroll } = useScrolled(scrollRef);
  useEffect(() => {
    if (didScroll.current || !scrollKey) return;
    const el = targetRef.current, sc = scrollRef.current;
    if (!el || !sc) return;
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTo({ top: Math.max(0, top - 8) });
    didScroll.current = true;
  });

  return (
    <div className="viewport-inner" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <AppHeader title="Schedule" go={go} scrolled={scrolled} />
      <div className="filterbar">
        <button className={"fchip" + (!person && !team ? " on":"")} onClick={()=>{setPerson(null);setTeam(null);}}>All matches</button>
        <button className={"fchip" + (person ? " on accent":"")} onClick={()=>setPick("person")}>
          {person ? <><Av p={person} size={18}/> {person.short}</> : <><Icon.people style={{width:13,height:13}}/> By person</>}
        </button>
        <button className={"fchip" + (team ? " on accent":"")} onClick={()=>setPick("team")}>
          {team ? <><Flag code={team} w={18} h={13} /> {S.team(team).name}</> : <><Icon.ball style={{width:13,height:13}}/> By team</>}
        </button>
      </div>

      <div className="scroll pad screen-anim" style={{paddingTop:4}} ref={scrollRef} onScroll={onScroll}>
        <div className="wrap">
          {days.length===0 && <div className="empty"><div className="ic">🗓️</div><h3>No matches</h3><p>Nothing matches that filter yet.</p></div>}
          {days.map(dk=>{
            const fs = byDay[dk];
            const d = fs[0];
            const isToday = dk === todayKey;
            return (
              <div key={dk} ref={dk===scrollKey ? targetRef : null}>
                <div className={"daydiv" + (isToday ? " today":"")}>
                  <span className="d">{isToday ? "Today" : d.dayLabel}</span>
                  <span className="ln"></span>
                  <span className="ct">{fs.length} {fs.length>1?"matches":"match"}</span>
                </div>
                <div className="mgrid">{fs.map(f=> <MatchCard key={f.id} f={f} onOpen={openMatch} />)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {pick && (
        <PickSheet kind={pick} onClose={()=>setPick(null)}
          onPerson={(p)=>{ setPerson(p); setTeam(null); setPick(null); }}
          onTeam={(c)=>{ setTeam(c); setPerson(null); setPick(null); }} />
      )}
    </div>
  );
}

export function PickSheet({ kind, onClose, onPerson, onTeam }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const people = ql
    ? S.people.filter(p => p.name.toLowerCase().includes(ql) || p.teams.some(tc => (S.team(tc)?.name || "").toLowerCase().includes(ql)))
    : S.people;
  const groups = S.groups
    .map(g => ({ g, teams: ql ? S.standings[g].filter(t => t.name.toLowerCase().includes(ql)) : S.standings[g] }))
    .filter(x => x.teams.length > 0);
  const empty = kind==="person" ? people.length===0 : groups.length===0;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"80%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>{kind==="person"?"Filter by person":"Filter by team"}</h3>
          <button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          <SearchInput value={q} onChange={setQ} placeholder={kind==="person"?"Search people…":"Search teams…"} autoFocus />
          {empty && <p style={{fontSize:13,color:"var(--muted2)",textAlign:"center",padding:"18px 0"}}>No {kind==="person"?"people":"teams"} match “{q}”.</p>}
          {kind==="person" ? (
            <div className="plist">
              {people.map(p=>(
                <div className="prow" key={p.id} onClick={()=>onPerson(p)} style={{padding:"9px 12px"}}>
                  <PersonAvatar p={p} cls="pav" style={{width:57,height:57,fontSize:22}}/>
                  <div className="pi"><b style={{fontSize:16}}>{p.name}</b>
                    <PersonTeams codes={p.teams} />
                  </div>
                  <Icon.chev className="chev"/>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {groups.map(({g, teams})=>(
                <div key={g} style={{marginBottom:14}}>
                  <div className="blocktitle" style={{border:0,padding:"4px 2px"}}>Group {g}</div>
                  {teams.map(t=>(
                    <div className="prow" key={t.code} onClick={()=>onTeam(t.code)} style={{padding:"8px 12px",marginBottom:7}}>
                      <Flag code={t.code} w={34} h={25} />
                      <div className="pi"><b style={{fontSize:16}}>{t.name}</b>
                        <div className="tms"><span className="t">{t.owners.length} owner{t.owners.length!==1?"s":""}</span></div></div>
                      <Icon.chev className="chev"/>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- STANDINGS ---------------- */
export function StandingsScreen({ go, openTeam, openKnockouts }) {
  const desktop = useIsDesktop();
  useSocial();
  const me = getMe();
  const myTeams = me ? me.teams : [];
  const scrollRef = useRef(null);
  const { scrolled, onScroll } = useScrolled(scrollRef);

  const cols = S.vocab.standingsCols;
  const cellFor = (t, key) => (key === "pct" ? (t.pct != null ? t.pct.toFixed(3).replace(/^0/, "") : "–") : t[key]);
  const showKoLink = S.competition?.format !== "league";
  const koLink = showKoLink
    ? <button className="iconbtn" onClick={openKnockouts} aria-label="Knockouts"><span style={{fontSize:17}}>🏆</span></button>
    : null;

  function GroupTable({ grp }) {
    const table = S.standings[grp];
    return (
      <div className="stand">
        <div className="gh"><b>{grp}</b><span className="leg"><i></i> Top 2 advance</span></div>
        <div className="strow">
          <span className="hd">#</span><span className="hd l">Team</span>
          {cols.map(([key,label])=> <span className="hd" key={key}>{label}</span>)}
        </div>
        {table.map((t,i)=>{
          const isTeamOut = S.isTeamEliminated(t.code);
          return (
            <div className={"strow"+(i<2?" q":i===2?" q3":"")+(myTeams.indexOf(t.code)>=0?" mine":"")+(isTeamOut?" is-eliminated":"")} key={t.code} onClick={()=>openTeam(t.code)} style={isTeamOut ? {opacity:0.45, filter:"grayscale(0.6)"} : {}}>
              <span className="pos">{i+1}</span>
              <span className="tm"><Flag code={t.code} w={22} h={16}/><span>{t.name}</span></span>
              {cols.map(([key,label])=> <span className={key==="pts" ? "pts" : "num"} key={key}>{cellFor(t,key)}</span>)}
            </div>
          );
        })}
      </div>
    );
  }

  if (desktop) {
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <AppHeader title="Standings" go={go} scrolled={scrolled} right={koLink} />
        <div className="scroll pad screen-anim" style={{paddingTop:16}} ref={scrollRef} onScroll={onScroll}>
          <div className="wrap">
            <div className="stand-desk-head">
              <div style={{fontSize:13,color:"var(--muted)",fontWeight:600,maxWidth:540,lineHeight:1.5}}>
                Tables update automatically as results come in — tap any team to open it.
              </div>
              <div className="legend">
                <span><i style={{background:"var(--live)"}}></i> Advance</span>
                <span><i style={{background:"var(--gold)"}}></i> Play-off (3rd)</span>
              </div>
            </div>
            <div className="standings-grid">
              {S.groups.map(x=> <GroupTable key={x} grp={x}/>)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <AppHeader title="Standings" go={go} scrolled={scrolled} right={koLink} />
      <div className="scroll pad screen-anim" style={{paddingTop:12}} ref={scrollRef} onScroll={onScroll}>
        <div className="wrap">
          {S.groups.map(x=> <GroupTable key={x} grp={x}/>)}
          <p style={{fontSize:11,color:"var(--muted)",lineHeight:1.5,padding:"2px 4px 0"}}>
            Tables update automatically as results come in.
          </p>
        </div>
      </div>
    </div>
  );
}

