/* ============================================================
   THE SWEEP — main screens: Home, Schedule, Standings, Knockouts
   ============================================================ */
import { useState, useEffect } from "react";
import { SWEEP as S } from "./data.js";
import {
  Icon, Flag, Av, AvStack, ProbBar, MatchCard, HomeHeader, PageHeader,
  useCountdown, useIsDesktop,
} from "./components.jsx";
import { useSocial, getMe, isWatching } from "./social.js";

/* ---------------- HOME ---------------- */
export function HomeScreen({ go, openMatch, openTeam, openPerson, onAdmin }) {
  const next = S.nextMatch;
  const t1 = S.team(next.t1), t2 = S.team(next.t2);
  const o = S.ownersForFixture(next);
  const cd = useCountdown(3*3600 + 42*60 + 11);

  const order = { live:0, upcoming:1, final:2 };
  const todayMatches = S.fixtures
    .filter(f => f.dayKey === S.todayKey && f.id !== next.id)
    .sort((a,b)=> (order[a.status]-order[b.status]) || (a.ko-b.ko))
    .slice(0,8);
  const results = S.fixtures.filter(f => f.status === "final").sort((a,b)=> b.ko - a.ko).slice(0,3);
  const groupA = S.standings["A"];

  useSocial(); // re-render on identity / watch / support changes
  const me = getMe();
  const watchOrder = { live:0, upcoming:1, final:2 };
  const watching = S.fixtures
    .filter(f => isWatching(f.id))
    .sort((a,b)=> (watchOrder[a.status]-watchOrder[b.status]) || (a.ko-b.ko));

  // personalized: my teams' next upcoming game(s)
  const myUpcoming = me ? S.fixtures
    .filter(f => f.status!=="final" && (me.teams.indexOf(f.t1)>=0 || me.teams.indexOf(f.t2)>=0))
    .sort((a,b)=> (watchOrder[a.status]-watchOrder[b.status]) || (a.ko-b.ko))
    .slice(0,2) : [];

  const approved = S.photos.filter(p=>p.status==="approved");
  const [pi, setPi] = useState(0);
  useEffect(()=>{ const t=setInterval(()=>setPi(x=>(x+1)%approved.length), 3500); return ()=>clearInterval(t); },[approved.length]);
  const photo = approved[pi];

  return (
    <div className="scroll pad screen-anim">
      <HomeHeader onAdmin={onAdmin}/>

      {/* hero next match */}
      <section className="hero">
        <div className="hero-top">
          {next.derby
            ? <span className="derby-tag"><span className="dot"></span> Community Derby</span>
            : <span className="derby-tag" style={{background:"#5b6f8e"}}>Next match</span>}
          <span className="hero-when">Kicks off in</span>
        </div>
        <div className="match-line">
          <div className="team" onClick={()=>openTeam(next.t1)}>
            <Flag code={next.t1} w={46} h={34} />
            <span className="nm">{t1.name.toUpperCase()}</span>
          </div>
          <div className="vs-cd">
            <span className="cd">{cd.hms}</span>
            <span className="cdl">HRS · MIN · SEC</span>
          </div>
          <div className="team" onClick={()=>openTeam(next.t2)}>
            <Flag code={next.t2} w={46} h={34} />
            <span className="nm">{t2.name.toUpperCase()}</span>
          </div>
        </div>
        <ProbBar prob={next.prob} />
        <div className="prob-key">
          <span><b>{next.prob.a}%</b> {next.t1.slice(0,3).toUpperCase()}</span>
          <span><b>{next.prob.d}%</b> Draw</span>
          <span>{next.t2.slice(0,3).toUpperCase()} <b>{next.prob.b}%</b></span>
        </div>
        <div className="hero-owners">
          <div className="ostack">
            <div className="lbl">{t1.name} · our people</div>
            <AvStack people={o.t1} size={24} light max={4}/>
            <div className="owner-names">{o.t1.map(p=>p.short).join(" · ")}</div>
          </div>
          <div className="ostack">
            <div className="lbl">{t2.name} · our people</div>
            <AvStack people={o.t2} size={24} light max={4}/>
            <div className="owner-names">{o.t2.map(p=>p.short).join(" · ")}</div>
          </div>
        </div>
      </section>

      <div className="wrap">
       <div className="deskhome">
        <div className="deskhome-main">
        {me && myUpcoming.length>0 && <>
          <div className="sec-h"><h2><span className="watch-eye"><Av p={me} size={17}/></span> Your next {myUpcoming.length>1?"games":"game"}</h2><span className="lnk" onClick={()=>openPerson ? openPerson(me) : go("people")}>Your profile →</span></div>
          <div className="mgrid">{myUpcoming.map(f=> <MatchCard key={"me"+f.id} f={f} onOpen={openMatch} />)}</div>
        </>}
        {watching.length>0 && <>
          <div className="sec-h"><h2><span className="watch-eye"><Icon.eyefill/></span> You're watching</h2><span className="lnk">{watching.length} match{watching.length>1?"es":""}</span></div>
          <div className="mgrid">{watching.map(f=> <MatchCard key={"w"+f.id} f={f} onOpen={openMatch} />)}</div>
        </>}
        <div className="sec-h"><h2>Today</h2><span className="lnk" onClick={()=>go("schedule")}>Full schedule →</span></div>
        <div className="mgrid">{todayMatches.map(f=> <MatchCard key={f.id} f={f} onOpen={openMatch} />)}</div>

        <div className="sec-h"><h2>Latest results</h2><span className="lnk" onClick={()=>go("schedule")}>All →</span></div>
        <div className="mgrid">{results.map(f=>{
          const ta=S.team(f.t1), tb=S.team(f.t2);
          return (
            <div className="res" key={f.id} onClick={()=>openMatch(f)}>
              <div className="rt"><Flag code={f.t1} w={24} h={18}/><span className="nm">{ta.name}</span></div>
              <span className="rscore">{f.score[0]} – {f.score[1]}</span>
              <div className="rt" style={{justifyContent:"flex-end"}}><span className="nm">{tb.name}</span><Flag code={f.t2} w={24} h={18}/></div>
              <span className="ft">FT</span>
            </div>
          );
        })}</div>
        </div>

        <div className="deskhome-side">
        <div className="sec-h"><h2>Standings · Group A</h2><span className="lnk" onClick={()=>go("standings")}>All groups →</span></div>
        <div className="stand">
          <div className="strow compact" style={{paddingBottom:2}}>
            <span className="hd">#</span><span className="hd l">Team</span><span className="hd">P</span><span className="hd">GD</span><span className="hd">PTS</span>
          </div>
          {groupA.map((t,i)=>(
            <div className={"strow compact" + (i<2?" q":i===2?" q3":"")} key={t.code} onClick={()=>openTeam(t.code)}>
              <span className="pos">{i+1}</span>
              <span className="tm"><Flag code={t.code} w={22} h={16}/><span>{t.name}</span>{t.owners.length>0 && <span className="owndot" title="Owned in the sweep"></span>}</span>
              <span className="num">{t.played}</span>
              <span className="num">{S.gd(t)>0?"+":""}{S.gd(t)}</span>
              <span className="pts">{t.pts}</span>
            </div>
          ))}
        </div>

        <div className="sec-h"><h2>From the community</h2><span className="lnk" onClick={()=>go("upload")}>Add yours →</span></div>
        <div className="fan" onClick={()=>openTeam(photo.team)}>
          <div className="ph"><span>FAN PHOTO · 16:10</span></div>
          <div className="badge"><img src={S.flag(photo.team,40)} alt=""/><span>{S.team(photo.team).name}</span></div>
          <div className="cap"><b>{photo.caption}</b><small>Posted by {photo.uploader} · approved</small></div>
        </div>
        <div className="dots">{approved.map((_,i)=><i key={i} className={i===pi?"on":""}></i>)}</div>
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

  // group by day
  const days = [];
  const byDay = {};
  list.forEach(f=>{ if(!byDay[f.dayKey]){ byDay[f.dayKey]=[]; days.push(f.dayKey);} byDay[f.dayKey].push(f); });

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
          {team ? <><img src={S.flag(team,40)} alt=""/> {S.team(team).name}</> : <><Icon.globe style={{width:13,height:13}}/> By team</>}
        </button>
      </div>

      <div className="scroll pad screen-anim" style={{paddingTop:4}}>
        <div className="wrap">
          {days.length===0 && <div className="empty"><div className="ic">🗓️</div><h3>No matches</h3><p>Nothing matches that filter yet.</p></div>}
          {days.map(dk=>{
            const fs = byDay[dk];
            const d = fs[0];
            const isToday = dk === S.todayKey;
            return (
              <div key={dk}>
                <div className="daydiv">
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
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"80%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>{kind==="person"?"Filter by person":"Filter by team"}</h3>
          <button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          {kind==="person" ? (
            <div className="plist">
              {S.people.map(p=>(
                <div className="prow" key={p.id} onClick={()=>onPerson(p)} style={{padding:"9px 12px"}}>
                  <span className="pav" style={{background:p.av,width:38,height:38,fontSize:15}}>{p.initials}</span>
                  <div className="pi"><b style={{fontSize:16}}>{p.name}</b>
                    <div className="tms">{p.teams.map(tc=><span className="t" key={tc}><img className="flag" src={S.flag(tc,40)} alt=""/>{S.team(tc).name}</span>)}</div>
                  </div>
                  <Icon.chev className="chev"/>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {S.groups.map(g=>(
                <div key={g} style={{marginBottom:14}}>
                  <div className="blocktitle" style={{border:0,padding:"4px 2px"}}>Group {g}</div>
                  {S.standings[g].map(t=>(
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

  function GroupTable({ grp }) {
    const table = S.standings[grp];
    return (
      <div className="stand">
        <div className="gh"><b>Group {grp}</b><span className="leg"><i></i> Top 2 advance</span></div>
        <div className="strow"><span className="hd">#</span><span className="hd l">Team</span><span className="hd">P</span><span className="hd">W</span><span className="hd">D</span><span className="hd">L</span><span className="hd">GD</span><span className="hd">PTS</span></div>
        {table.map((t,i)=>(
          <div className={"strow"+(i<2?" q":i===2?" q3":"")} key={t.code} onClick={()=>openTeam(t.code)}>
            <span className="pos">{i+1}</span>
            <span className="tm"><Flag code={t.code} w={22} h={16}/><span>{t.name}</span>{t.owners.length>0 && <span className="owndot" title="Owned in the sweep"></span>}</span>
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
                Tables update automatically twice a day from the results feed. <b style={{color:"var(--accent)"}}>●</b> marks a team someone in the sweep drew — tap any to open it.
              </div>
              <div className="legend">
                <span><i style={{background:"var(--live)"}}></i> Advance</span>
                <span><i style={{background:"var(--gold)"}}></i> Play-off (3rd)</span>
                <span><i style={{background:"var(--accent)"}}></i> Owned</span>
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
            Tables update automatically twice a day from the results feed. <b style={{color:"var(--accent)"}}>●</b> marks a team someone in the sweep drew.
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
