/* ============================================================
   THE SWEEP — main screens: Home, Schedule, Standings, Knockouts
   ============================================================ */
import { useState, useEffect, useRef, useMemo } from "react";
import { SWEEP as S } from "./data.js";
import {
  Icon, Flag, Av, AvStack, PersonAvatar, ProbBar, MatchCard, CrowdPick, HomeHeader, PageHeader,
  SearchInput, useCountdown, useIsDesktop,
} from "./components.jsx";
import { useSocial, getMe, isWatching, toast, predictionLeaderboard } from "./social.js";

/* ---------------- HOME ---------------- */
export function HomeScreen({ go, openMatch, openTeam, openPerson, openPhoto, onAdmin }) {
  const next = S.nextMatch;
  const t1 = S.team(next.t1), t2 = S.team(next.t2);
  const o = S.ownersForFixture(next);
  const cd = useCountdown(Math.max(0, Math.floor((next.ko.getTime() - Date.now()) / 1000)));

  useSocial(); // re-render on identity / watch / support changes
  const me = getMe();

  const order = { live:0, upcoming:1, final:2 };
  // soonest games, in natural order — your games are highlighted inline (not floated to the top)
  const nextMatches = S.fixtures
    .filter(f => f.status !== "final" && f.id !== next.id)
    .sort((a,b)=> (order[a.status]-order[b.status]) || (a.ko-b.ko))
    .slice(0,8);
  const results = S.fixtures.filter(f => f.status === "final").sort((a,b)=> b.ko - a.ko).slice(0,3);
  // pick a random group for the side standings — chosen once per mount so it stays stable across re-renders
  const groupKeys = Object.keys(S.standings);
  const grpKey = useMemo(() => groupKeys.length ? groupKeys[Math.floor(Math.random()*groupKeys.length)] : "A", [groupKeys.join(",")]);
  const groupStand = S.standings[grpKey] || [];

  // top 4 people by team wins (across finished matches)
  const finals = S.fixtures.filter(f => f.status === "final" && f.score);
  const winnerOf = (f) => f.score[0] > f.score[1] ? f.t1 : f.score[1] > f.score[0] ? f.t2 : null;
  const topWinners = S.people
    .map(p => ({ person: p, wins: finals.reduce((n,f)=> n + (p.teams.indexOf(winnerOf(f))>=0 ? 1 : 0), 0) }))
    .filter(r => r.wins > 0)
    .sort((a,b)=> b.wins - a.wins)
    .slice(0,4);
  const accurate = predictionLeaderboard(4); // top predictors by correct crowd calls

  const approved = S.photos.filter(p=>p.status==="approved" && p.kind==="fan");
  const [pi, setPi] = useState(0);
  useEffect(()=>{ if(approved.length===0) return; const t=setInterval(()=>setPi(x=>(x+1)%approved.length), 3500); return ()=>clearInterval(t); },[approved.length]);
  const photo = approved[pi];
  const photoFx = photo ? S.fixture(photo.fixtureId) : null;

  return (
    <div className="scroll pad screen-anim">
      <HomeHeader onAdmin={onAdmin} go={go}/>

      {/* hero next match */}
      <section className="hero">
        <div className="hero-top">
          <span className="derby-tag" style={{background:"#5b6f8e"}}>Next match</span>
          <span className="hero-when">Kicks off in</span>
        </div>
        <div className="match-line">
          <div className="team" onClick={()=>openTeam(next.t1)}>
            <Flag code={next.t1} w={46} h={34} />
            <span className="nm">{t1.name.toUpperCase()}</span>
          </div>
          <div className="vs-cd">
            <span className="cd">{cd.display}</span>
            <span className="cdl">{cd.unit}</span>
          </div>
          <div className="team" onClick={()=>openTeam(next.t2)}>
            <Flag code={next.t2} w={46} h={34} />
            <span className="nm">{t2.name.toUpperCase()}</span>
          </div>
        </div>
        {next.hasOdds && <>
        <ProbBar prob={next.prob} />
        <div className="prob-key">
          <span><b>{next.prob.a}%</b> {next.t1.slice(0,3).toUpperCase()}</span>
          <span><b>{next.prob.d}%</b> Draw</span>
          <span>{next.t2.slice(0,3).toUpperCase()} <b>{next.prob.b}%</b></span>
        </div>
        </>}
        <CrowdPick f={next} onToast={toast} light locked={next.status !== "upcoming"} />
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
        <div className="deskhome-main">
        <div className="sec-h"><h2>Next games</h2><span className="lnk" onClick={()=>go("schedule")}>Full schedule →</span></div>
        <div className="mgrid">{nextMatches.map(f=> <MatchCard key={f.id} f={f} onOpen={openMatch} />)}</div>
        </div>

        <div className="deskhome-side">
        {topWinners.length>0 && <>
        <div className="sec-h"><h2>Most wins</h2><span className="lnk" onClick={()=>go("people")}>People →</span></div>
        <div className="ranklist">{topWinners.map((r,i)=>(
          <div className="rankrow" key={r.person.id} onClick={()=>openPerson(r.person)}>
            <span className="rk">{i+1}</span>
            <PersonAvatar p={r.person} cls="av" style={{width:30,height:30,border:0,margin:0,fontSize:12}}/>
            <span className="rname">{r.person.name}</span>
            <b className="rval">{r.wins}<i>W</i></b>
          </div>
        ))}</div>
        </>}

        {results.length>0 && <>
        <div className="sec-h"><h2>Latest scores</h2><span className="lnk" onClick={()=>go("schedule")}>All →</span></div>
        <div className="sidescores">{results.map(f=>{
          const ta=S.team(f.t1), tb=S.team(f.t2);
          return (
            <div className="res" key={f.id} onClick={()=>openMatch(f)}>
              <div className="rt"><Flag code={f.t1} w={22} h={16}/><span className="nm">{ta.name}</span></div>
              <span className="rscore">{f.score[0]} – {f.score[1]}</span>
              <div className="rt" style={{justifyContent:"flex-end"}}><span className="nm">{tb.name}</span><Flag code={f.t2} w={22} h={16}/></div>
              <span className="ft">FT</span>
            </div>
          );
        })}</div>
        </>}

        {accurate.length>0 && <>
        <div className="sec-h"><h2>Best predictions</h2><span className="lnk" onClick={()=>go("people")}>People →</span></div>
        <div className="ranklist">{accurate.map((r,i)=>(
          <div className="rankrow" key={r.person.id} onClick={()=>openPerson(r.person)}>
            <span className="rk">{i+1}</span>
            <PersonAvatar p={r.person} cls="av" style={{width:30,height:30,border:0,margin:0,fontSize:12}}/>
            <span className="rname">{r.person.name}</span>
            <b className="rval">{r.correct}</b>
          </div>
        ))}</div>
        </>}

        <div className="sec-h"><h2>Standings · Group {grpKey}</h2><span className="lnk" onClick={()=>go("standings")}>All groups →</span></div>
        <div className="stand">
          <div className="strow compact" style={{paddingBottom:2}}>
            <span className="hd">#</span><span className="hd l">Team</span><span className="hd">P</span><span className="hd">GD</span><span className="hd">PTS</span>
          </div>
          {groupStand.map((t,i)=>(
            <div className={"strow compact" + (i<2?" q":i===2?" q3":"") + (me && me.teams.indexOf(t.code)>=0?" mine":"")} key={t.code} onClick={()=>openTeam(t.code)}>
              <span className="pos">{i+1}</span>
              <span className="tm"><Flag code={t.code} w={22} h={16}/><span>{t.name}</span></span>
              <span className="num">{t.played}</span>
              <span className="num">{S.gd(t)>0?"+":""}{S.gd(t)}</span>
              <span className="pts">{t.pts}</span>
            </div>
          ))}
        </div>

        <div className="sec-h"><h2>From the community</h2><span className="lnk" onClick={()=>go("upload")}>Add yours →</span></div>
        {photo ? <>
        <div className="fan" onClick={()=>openPhoto(photo)}>
          {photo.src ? <img className="ph" src={photo.src} alt={photo.caption||"Fan photo"} loading="lazy"/> : <div className="ph"><span>FAN PHOTO</span></div>}
          {photoFx && <div className="badge"><img src={S.flag(photoFx.t1,40)} alt=""/><img src={S.flag(photoFx.t2,40)} alt=""/><span>{S.team(photoFx.t1).name} v {S.team(photoFx.t2).name}</span></div>}
          <div className="cap"><b>{photo.caption}</b><small>Posted by {photo.uploader} · approved</small></div>
        </div>
        <div className="dots">{approved.map((_,i)=><i key={i} className={i===pi?"on":""}></i>)}</div>
        </> : <div className="fan empty" onClick={()=>go("upload")}><div className="ph"><span>No fan photos yet</span></div><div className="cap"><small>Be the first — tap to add yours.</small></div></div>}
        </div>
       </div>
      </div>
    </div>
  );
}

/* ---------------- SCHEDULE ---------------- */
export function ScheduleScreen({ openMatch, openPerson }) {
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
      <PageHeader title="Schedule" sub="All group fixtures · Sydney time" tall
        right={<div className="iconbtn"><Icon.cal/></div>} />
      <div className="filterbar">
        <button className={"fchip" + (!person && !team ? " on":"")} onClick={()=>{setPerson(null);setTeam(null);}}>All matches</button>
        <button className={"fchip" + (person ? " on accent":"")} onClick={()=>setPick("person")}>
          {person ? <><Av p={person} size={18}/> {person.short}</> : <><Icon.people style={{width:13,height:13}}/> By person</>}
        </button>
        <button className={"fchip" + (team ? " on accent":"")} onClick={()=>setPick("team")}>
          {team ? <><img src={S.flag(team,40)} alt=""/> {S.team(team).name}</> : <><Icon.ball style={{width:13,height:13}}/> By team</>}
        </button>
      </div>

      <div className="scroll pad screen-anim" style={{paddingTop:4}} ref={scrollRef}>
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
                    <div className="tms">{p.teams.map(tc=><span className="t" key={tc}><img className="flag" src={S.flag(tc,40)} alt=""/>{S.team(tc).name}</span>)}</div>
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
                      <img className="flag" src={S.flag(t.code,80)} alt="" style={{width:34,height:25,borderRadius:4}}/>
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
export function StandingsScreen({ openTeam, openKnockouts }) {
  const desktop = useIsDesktop();
  const [g, setG] = useState("A");
  useSocial();
  const me = getMe();
  const myTeams = me ? me.teams : [];

  function GroupTable({ grp }) {
    const table = S.standings[grp];
    return (
      <div className="stand">
        <div className="gh"><b>Group {grp}</b><span className="leg"><i></i> Top 2 advance</span></div>
        <div className="strow"><span className="hd">#</span><span className="hd l">Team</span><span className="hd">P</span><span className="hd">W</span><span className="hd">D</span><span className="hd">L</span><span className="hd">GD</span><span className="hd">PTS</span></div>
        {table.map((t,i)=>(
          <div className={"strow"+(i<2?" q":i===2?" q3":"")+(myTeams.indexOf(t.code)>=0?" mine":"")} key={t.code} onClick={()=>openTeam(t.code)}>
            <span className="pos">{i+1}</span>
            <span className="tm"><Flag code={t.code} w={22} h={16}/><span>{t.name}</span></span>
            <span className="num">{t.played}</span>
            <span className="num">{t.win}</span>
            <span className="num">{t.draw}</span>
            <span className="num">{t.loss}</span>
            <span className="num">{S.gd(t)>0?"+":""}{S.gd(t)}</span>
            <span className="pts">{t.pts}</span>
          </div>
        ))}
      </div>
    );
  }

  if (desktop) {
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <PageHeader title="Standings" sub="All 12 groups · auto-calculated from results" tall
          right={<button className="iconbtn" onClick={openKnockouts} aria-label="Knockouts"><span style={{fontSize:17}}>🏆</span></button>} />
        <div className="scroll pad screen-anim" style={{paddingTop:16}}>
          <div className="wrap">
            <div className="stand-desk-head">
              <div style={{fontSize:13,color:"var(--muted)",fontWeight:600,maxWidth:540,lineHeight:1.5}}>
                Tables update automatically twice a day from the results feed — tap any team to open it.
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
      <PageHeader title="Standings" sub="Auto-calculated from results" tall
        right={<button className="iconbtn" onClick={openKnockouts} aria-label="Knockouts"><span style={{fontSize:17}}>🏆</span></button>} />
      <div className="filterbar">
        {S.groups.map(x=>(
          <button key={x} className={"fchip"+(x===g?" on":"")} onClick={()=>setG(x)} style={{minWidth:44,justifyContent:"center"}}>Grp {x}</button>
        ))}
      </div>
      <div className="scroll pad screen-anim" style={{paddingTop:6}}>
        <div className="wrap">
          <GroupTable grp={g}/>
          <p style={{fontSize:11,color:"var(--muted)",lineHeight:1.5,padding:"2px 4px 0"}}>
            Tables update automatically twice a day from the results feed.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- KNOCKOUTS (empty state) ---------------- */
export function KnockoutsScreen({ onBack }) {
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="Knockouts" sub="Round of 32 onward" onBack={onBack} tall />
      <div className="scroll pad screen-anim ko-wrap">
        <div className="ko-card">
          <div className="ko-trophy">🏆</div>
          <h3>Bracket unlocks after the groups</h3>
          <p>Once all 12 groups wrap, the Round of 32 fills in here automatically — with every community owner still alive carried through.</p>
        </div>
        <div className="ko-stage-label">Round of 32 · preview</div>
        <div className="ko-bracket">
          {[0,1,2,3,4].map(i=>(
            <div className="ko-slot" key={i}>
              <span className="q">{i+1}</span>
              <span className="ln"></span>
              <span className="ln short"></span>
            </div>
          ))}
        </div>
        <p style={{fontSize:11.5,color:"var(--muted)",textAlign:"center",lineHeight:1.5,padding:"14px 24px 0"}}>
          The data model already supports knockout fixtures — this tab switches on the moment the group stage ends.
        </p>
      </div>
    </div>
  );
}
