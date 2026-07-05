/* ============================================================
   THE SWEEP — detail screens + flows
   ============================================================ */
import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SWEEP as S, onSweepData } from "./data.js";
import { whenLabel, liveLabel } from "./lib/format.js";
import { celebrate } from "./lib/celebrate.js";
import { isShootoutKick } from "./lib/assemble.js";
import {
  Icon, Flag, AvStack, PersonAvatar, MatchCard, PageHeader, AppHeader, SearchInput, SquadList, useScrolled, resultFor, useCountdown, ScoreCover, PersonTeams, PenScore,
} from "./components.jsx";
import {
  useSocial, getMe,
  supportOf, mySupport, setSupport, DRAW,
  predictionsOf, predictionAccuracy,
} from "./social.js";
import { useSpoiler, spoilerHidden } from "./spoiler.js";
import { balanceByPerson, useCoins, canWager } from "./coins.js";
import { InstallButton } from "./InstallPrompt.jsx";
import { uploadPhoto, adminLogin, fetchAdminPhotos, moderatePhoto, settleStaleBets, fetchOpenBets, fetchWhoami, createPerson, deletePerson, patchPerson, bulkPostOwnership, bulkDeleteOwnership } from "./api/client.js";
import { SingleBetRow, ParlayCard } from "./screens-coins.jsx";
import { refreshAdminBadge } from "./admin.js";
import { allocateRandomForPerson } from "./lib/allocate.js";
import { SweepDraw } from "./SweepDraw.jsx";

/* Shared "Hide eliminated" filter toggle — same look/label on People and Teams. */
function HideEliminatedToggle({ on, onToggle }) {
  return (
    <button className={"fchip" + (on ? " on accent" : "")} onClick={onToggle} aria-pressed={on}
      style={{fontSize:12,padding:"6px 12px",borderRadius:8,fontWeight:700,whiteSpace:"nowrap"}}>
      Hide eliminated
    </button>
  );
}

/* ---------------- PEOPLE ---------------- */
export function PeopleScreen({ go, openPerson, initialView = "wins" }) {
  useSocial(); // re-render as picks/support arrive so prediction counts stay live
  useCoins();  // re-render (and re-sort) when balances load / change
  const scrollRef = useRef(null);
  const { scrolled, onScroll } = useScrolled(scrollRef);
  const [q, setQ] = useState("");
  const [view, setView] = useState(initialView); // 'wins' | 'predictions' | 'coins'
  const [hideEliminated, setHideEliminated] = useState(false);
  const ql = q.trim().toLowerCase();
  const balances = balanceByPerson();
  // wagers are 18+; minors / not-signed-in can't filter by coin balance
  const wager = canWager();
  const av = (!wager && view === "coins") ? "wins" : view;
  // Confetti when the winner is on show: fire once each time the Placement tab
  // is opened while someone has clinched 1st (🏆). Re-arms when you leave the tab.
  const celebratedRef = useRef(false);
  const hasChampion = S.people.some(p => S.placementOf(p.id)?.champion);
  useEffect(() => {
    if (av === "placement" && hasChampion) {
      if (!celebratedRef.current) { celebratedRef.current = true; celebrate(); }
    } else celebratedRef.current = false;
  }, [av, hasChampion]);
  // minors have no wagers → treated as 0 (sorts to the bottom, no pill); adults
  // always show their balance, including 0 once they've spent it all
  const coinsVal = (m) => m.person.adult === false ? 0 : (balances[m.person.id] ?? 0);
  // placement sort key: still-in (no placement) → 0 (top); placed → its position
  const placeKey = (m) => { const pl = S.placementOf(m.person.id); return pl ? pl.start : 0 };
  // per-person stat for the active view: { value, label, show }
  const statOf = (m) => {
    if (av === "placement") {
      const pl = S.placementOf(m.person.id);
      if (!pl) return { value: null, label: null, show: false };
      const range = pl.end > pl.start ? `${pl.start}–${pl.end}` : `${pl.start}`;
      return { value: pl.champion ? `🏆 ${range}` : range, label: "place", show: true };
    }
    if (av === "predictions") { const v = predictionAccuracy(m.person.id).correct; return { value: v, label: "correct", show: v > 0 }; }
    if (av === "coins") return { value: coinsVal(m), label: "Yowie Dollars", show: m.person.adult !== false };
    return { value: m.wins, label: m.wins === 1 ? "win" : "wins", show: m.wins > 0 };
  };
  let list = ql
    ? S.money.filter(m => m.person.name.toLowerCase().includes(ql) || m.person.teams.some(tc => (S.team(tc)?.name || "").toLowerCase().includes(ql)))
    : S.money;
  // Yowie Dollars is 18+ — minors have no wagers at all, so showing them here (even at
  // the bottom with no pill) just reads as confusing dead rows. Drop them from this view.
  if (av === "coins") list = list.filter(m => m.person.adult !== false);
  // "Hide eliminated" is meaningless in the Placement view (it hides exactly the people who have a placement)
  if (hideEliminated && av !== "placement") list = list.filter(m => !S.isPersonEliminated(m.person.id));
  if (av === "predictions") // S.money is pre-sorted by wins; re-sort by correct calls
    list = list.slice().sort((a,b) => predictionAccuracy(b.person.id).correct - predictionAccuracy(a.person.id).correct);
  else if (av === "coins") // re-sort by Yowie Dollars balance descending
    list = list.slice().sort((a,b) => coinsVal(b) - coinsVal(a));
  else if (av === "placement") // still-in (0) at top, then by finishing position ascending
    list = list.slice().sort((a,b) => (placeKey(a) - placeKey(b)) || (b.wins - a.wins));
  // headcount reflects the active view — adults only for the 18+ Yowie Dollars board
  const activeCount = S.people.filter(p => !S.isPersonEliminated(p.id)).length;
  const totalCount = S.people.length;
  const headCount = av === "coins" ? S.people.filter(p => p.adult !== false).length : totalCount;
  const placedCount = S.people.filter(p => S.placementOf(p.id)).length;
  const subLabel = av === "predictions"
    ? `${headCount} in the sweep · sorted by correct predictions`
    : av === "coins"
    ? `${headCount} adult${headCount === 1 ? "" : "s"} · sorted by Yowie Dollars balance`
    : av === "placement"
    ? `${placedCount} of ${totalCount} placed · by finishing position`
    : `${activeCount} out of ${totalCount} are still in the running · sorted by team wins`;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <AppHeader title="People" go={go} scrolled={scrolled} />
      <div className="scroll pad screen-anim" style={{paddingTop:14}} ref={scrollRef} onScroll={onScroll}>
        <div className="wrap">
          <div style={{maxWidth:440,margin:"2px 0 12px"}}>
            <SearchInput value={q} onChange={setQ} placeholder="Search by name or team…" />
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:10, gap:8}}>
              <div className="statseg" style={{flex:1, gridTemplateColumns:`repeat(${wager?4:3}, 1fr)`}}>
                <button className={"statseg-opt"+(av==="wins"?" on":"")} onClick={()=>setView("wins")}>Wins</button>
                <button className={"statseg-opt"+(av==="predictions"?" on":"")} onClick={()=>setView("predictions")}>Predictions</button>
                {wager && <button className={"statseg-opt"+(av==="coins"?" on":"")} onClick={()=>setView("coins")}>Yowie Dollars</button>}
                <button className={"statseg-opt"+(av==="placement"?" on":"")} onClick={()=>setView("placement")}>Placement</button>
              </div>
            </div>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8}}>
              <p style={{fontSize:12,color:"var(--muted2)",fontWeight:600,margin:0}}>{subLabel}</p>
              {av !== "placement" && <HideEliminatedToggle on={hideEliminated} onToggle={()=>setHideEliminated(!hideEliminated)} />}
            </div>
          </div>
          {list.length===0 && <p style={{fontSize:13,color:"var(--muted2)",padding:"8px 2px"}}>No one matches “{q}”.</p>}
          <div className="plist">
            {list.map(m=>{
              const p = m.person;
              const stat = statOf(m);
              const isElim = av === "wins" && S.isPersonEliminated(p.id);
              return (
                <div className="prow" key={p.id} onClick={()=>openPerson(p)}>
                  <PersonAvatar p={p} cls="pav"/>
                  <div className="pi">
                    <b>{p.name}{isElim && <span className="elim-badge elim-badge-red">OUT</span>}</b>
                    <PersonTeams codes={p.teams} hideEliminated={hideEliminated} />
                  </div>
                  {stat.show && (
                    <div className="stat">
                      <div className="pp">{typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}</div>
                      <small style={{color:"var(--muted2)"}}>{stat.label}</small>
                    </div>
                  )}
                  <Icon.chev className="chev"/>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- PERSON DETAIL ---------------- */
export function PersonDetail({ person, onBack, openMatch, openTeam, openProfileUpload }) {
  useSocial();
  useSpoiler();
  useCoins();
  const isMe = getMe()?.id === person.id;
  const myCoins = balanceByPerson()[person.id] ?? 0;
  const myFixtures = S.fixtures.filter(f => person.teams.indexOf(f.t1)>=0 || person.teams.indexOf(f.t2)>=0);
  const next = myFixtures.filter(f=> f.status==="upcoming").sort((a,b)=>a.ko-b.ko)[0];
  const cd = next ? useCountdown(Math.max(0, Math.floor((next.ko.getTime() - Date.now())/1000))) : null;
  const money = S.money.find(m=>m.person.id===person.id);
  const myTeams = person.teams.map(c=>S.team(c));
  const played = myFixtures.filter(f=>f.status==="final");
  // Result of a fixture from this person's side. If they own BOTH teams, one of
  // their teams always wins (or it's a draw) — never a loss. Returns the team
  // code to show (the winner when both are owned) + the W/L/D code.
  const matchResult = (f) => {
    const ownsT1 = person.teams.indexOf(f.t1) >= 0, ownsT2 = person.teams.indexOf(f.t2) >= 0;
    if (ownsT1 && ownsT2) {
      if (f.status !== "final") return { myCode: f.t1, r: resultFor(f, f.t1) };
      if (f.winnerCode && f.winnerCode !== "DRAW") return { myCode: f.winnerCode, r: "w" };
      const draw = f.score[0] === f.score[1], t1Won = f.score[0] > f.score[1];
      return { myCode: (draw || t1Won) ? f.t1 : f.t2, r: draw ? "d" : "w" };
    }
    const myCode = ownsT1 ? f.t1 : f.t2;
    return { myCode, r: resultFor(f, myCode) };
  };
  const wins = played.filter(f => matchResult(f).r === "w").length;
  const acc = predictionAccuracy(person.id);
  const preds = predictionsOf(person.id);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <header className="top" style={{padding:0,overflow:"visible"}}>
        <div className="detail-hero" style={{paddingTop:14}}>
          <div className="dh-person">
            <button className="backbtn" onClick={onBack}><Icon.back/></button>
            <div className="dh-av">
              <PersonAvatar p={person} cls="pav"/>
              {isMe && <button className="av-cam" onClick={()=>openProfileUpload && openProfileUpload()} aria-label="Upload profile photo" title="Upload profile photo"><Icon.camera/></button>}
            </div>
            <div className="dh-id" style={{minWidth:0}}>
              <h2>{person.name}</h2>
              {(() => {
                const isPersonOut = S.isPersonEliminated(person.id);
                const statusTag = isPersonOut ? "OUT" : money.tag;
                return (
                  <div className="meta">
                    <span style={isPersonOut ? {color:"#ff6b6b",fontWeight:800} : undefined}>{statusTag}</span>
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="dh-stats">
            <div className="dh-stat"><b>{myTeams.length}</b><small>Teams drawn</small></div>
            <div className="dh-stat"><b>{played.length}</b><small>Games played</small></div>
            <div className="dh-stat"><b>{wins}</b><small>Wins</small></div>
            <div className="dh-stat"><b>{acc.correct}/{acc.total}</b><small>Calls right</small></div>
            {canWager() && person.adult !== false && <div className="dh-stat"><b>{myCoins.toLocaleString()}</b><small>Yowie Dollars</small></div>}
          </div>
        </div>
      </header>
      <div className="scroll pad screen-anim">
        <div className="wrap" style={{marginTop:16}}>
          {next && (
            <>
              <div className="sec-h"><h2>Next up</h2><span className="lnk cd-lnk">{cd.display}</span></div>
              <MatchCard f={next} onOpen={openMatch} />
            </>
          )}

          <div className="sec-h"><h2>Teams drawn</h2></div>
          {myTeams.map(t=>{
            const isTeamOut = S.isTeamEliminated(t.code);
            return (
              <div className={"teamtile" + (isTeamOut ? " is-eliminated" : "")} key={t.code} onClick={()=>openTeam(t.code)} style={isTeamOut ? {opacity:0.5, filter:"grayscale(0.6)"} : undefined}>
                <div className="tcbar" style={{background:t.color}}></div>
                <Flag code={t.code} w={50} h={36} cls={"bigflag" + (isTeamOut ? " is-elim" : "")} />
                <div className="ti">
                  <b>{t.name}{isTeamOut && <span className="elim-badge">OUT</span>}</b>
                  <div className="sub"><span className="poolbadge">Pool {t.pool}</span><span>Group {t.group}</span><span>{t.outlook}</span></div>
                </div>
                <div className="wbox"><b>{t.strength}</b><small>Strength</small></div>
              </div>
            );
          })}

          <div className="sec-h"><h2>All their matches</h2></div>
          <div className="block">
            {myFixtures.map(f=>{
              const { myCode, r } = matchResult(f);
              const oppCode = myCode===f.t1 ? f.t2 : f.t1;
              const live = f.status==="live";
              return (
                <div className="mini-fx" key={f.id} onClick={()=>openMatch(f)}>
                  <div className="fx-main">
                    <div className="opp">
                      <Flag code={myCode} w={24} h={18}/>
                      <span className="nm">{S.team(myCode).name}</span>
                      <span className="vs">v</span>
                      <Flag code={oppCode} w={24} h={18}/>
                      <span className="nm">{S.team(oppCode).name}</span>
                    </div>
                    <div className={"fx-when"+(live?" live":"")}>{whenLabel(f, S.vocab.ftShort)}</div>
                  </div>
                  <div className="rr">
                    {(f.status==="final"||live) && (spoilerHidden(f) ? <ScoreCover f={f}/> : (
                      <span className="sc">
                        {myCode===f.t1?f.score[0]:f.score[1]}–{myCode===f.t1?f.score[1]:f.score[0]}
                        {f.penScore && (() => {
                          const pSelf = myCode===f.t1 ? f.penScore[0] : f.penScore[1];
                          const pOpp = myCode===f.t1 ? f.penScore[1] : f.penScore[0];
                          return (
                            <span style={{ fontSize: 10, color: "var(--muted2)", marginLeft: 6, fontWeight: 700, fontFamily: "sans-serif" }}>
                              (
                              <span style={{ color: pSelf > pOpp ? "var(--navy)" : "inherit" }}>{pSelf}</span>
                              –
                              <span style={{ color: pOpp > pSelf ? "var(--navy)" : "inherit" }}>{pOpp}</span>
                              )
                            </span>
                          );
                        })()}
                      </span>
                    ))}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && f.hasOdds && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{(!S.competition.hasDraws || f.stage==="knockout"?f.prob2:f.prob3)[myCode===f.t1?"pa":"pb"]}%</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {preds.length>0 && <>
          <div className="sec-h"><h2>Prediction history</h2></div>
          <div className="block">
            {preds.map(({f, pick, verdict})=>{
              const live = f.status==="live";
              const isDraw = pick===DRAW;
              return (
                <div className="mini-fx" key={f.id} onClick={()=>openMatch(f)}>
                  <div className="fx-main">
                    <div className="opp">
                      <Flag code={f.t1} w={24} h={18}/>
                      <span className="nm">{S.team(f.t1).name}</span>
                      <span className="vs">v</span>
                      <Flag code={f.t2} w={24} h={18}/>
                      <span className="nm">{S.team(f.t2).name}</span>
                    </div>
                    <div className={"fx-when"+(live?" live":"")}>{whenLabel(f, S.vocab.ftShort)}</div>
                  </div>
                  <div className="rr">
                    {isDraw
                      ? <span className="pick-draw" title="Picked a draw" role="img" aria-label="Picked a draw">🤝</span>
                      : <span className="pick-flag" title={`Picked ${S.team(pick).name}`}><Flag code={pick} w={24} h={18}/></span>}
                    {verdict==="correct" && <span className="v-pill ok" title="Correct call">✓</span>}
                    {verdict==="wrong" && <span className="v-pill no" title="Wrong call">✗</span>}
                    {verdict===null && <span className="pick-pending" title="Not played yet" role="img" aria-label="Not played yet"><Icon.spinner/></span>}
                  </div>
                </div>
              );
            })}
          </div>
          </>}

          {isMe && <div style={{marginTop:22}}><InstallButton/></div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- TEAMS ---------------- */
export function TeamsScreen({ go, openTeam }) {
  const [mode, setMode] = useState("group"); // group | pool
  const [hideElim, setHideElim] = useState(false);
  const [q, setQ] = useState("");
  const scrollRef = useRef(null);
  const { scrolled, onScroll } = useScrolled(scrollRef);
  const ql = q.trim().toLowerCase();
  const matches = ql
    ? S.teamList.filter(t => t.name.toLowerCase().includes(ql) || t.code.toLowerCase().includes(ql))
                .sort((a,b)=> b.pts - a.pts || a.name.localeCompare(b.name))
    : null;
  const totalTeams = S.teamList.length;
  const aliveTeams = S.teamList.filter(t => !S.isTeamEliminated(t.code)).length;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <AppHeader title="Teams" go={go} scrolled={scrolled} />
      <div className="filterbar">
        <button className={"fchip"+(mode==="group"?" on":"")} onClick={()=>setMode("group")}>{`By ${S.vocab.groupLabel.toLowerCase()}`}</button>
        <button className={"fchip"+(mode==="pool"?" on":"")} onClick={()=>setMode("pool")}>By sweep pool</button>
      </div>
      <div className="scroll pad screen-anim" style={{paddingTop:8}} ref={scrollRef} onScroll={onScroll}>
        <div className="wrap">
          <div style={{maxWidth:440,margin:"2px 0 12px"}}>
            <SearchInput value={q} onChange={setQ} placeholder="Search teams…" />
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8}}>
              <p style={{fontSize:12,color:"var(--muted2)",fontWeight:600,margin:0}}>{aliveTeams} out of {totalTeams} teams still in the running</p>
              <HideEliminatedToggle on={hideElim} onToggle={()=>setHideElim(v=>!v)} />
            </div>
          </div>
          {matches ? (
            matches.length === 0
              ? <p style={{fontSize:13,color:"var(--muted2)",padding:"8px 2px"}}>No teams match “{q}”.</p>
              : <TeamGroup title={matches.length+" team"+(matches.length!==1?"s":"")} teams={matches} openTeam={openTeam} hideElim={hideElim} />
          ) : mode==="group" ? S.groups.map(g=>(
            <TeamGroup key={g} title={"Group "+g} teams={S.standings[g]} openTeam={openTeam} rank hideElim={hideElim} />
          )) : ["A","B"].map(pool=>(
            <TeamGroup key={pool} title={"Pool "+pool} teams={S.teamList.filter(t=>t.pool===pool).sort((a,b)=>b.strength-a.strength)} openTeam={openTeam} hideElim={hideElim} hidePts />
          ))}
        </div>
      </div>
    </div>
  );
}
export function TeamGroup({ title, teams, openTeam, rank, hideElim, hidePts }) {
  useSocial();
  const me = getMe();
  const myTeams = me ? me.teams : [];
  // when hiding eliminated, drop a whole group/pool that has nothing left to show
  if (hideElim && teams.every(t => S.isTeamEliminated(t.code))) return null;
  return (
    <div style={{marginBottom:6}}>
      <div className="sec-h" style={{marginBottom:7}}><h2>{title}</h2></div>
      <div className="plist" style={{marginBottom:12}}>
        {teams.map((t,i)=>{
          const isTeamOut = S.isTeamEliminated(t.code);
          if (hideElim && isTeamOut) return null; // skip the row but keep i so ranks don't renumber
          return (
            <div className={"prow"+(myTeams.indexOf(t.code)>=0?" mine":"")+(isTeamOut?" is-eliminated":"")} key={t.code} onClick={()=>openTeam(t.code)} style={{padding:"9px 12px", ...(isTeamOut ? {opacity:0.5, filter:"grayscale(0.6)"} : {})}}>
              {rank && <span className="pos" style={{width:14,fontFamily:"'Barlow Condensed'",fontWeight:800,color:i<2?"var(--live)":i===2?"var(--gold)":"var(--muted2)"}}>{i+1}</span>}
              <Flag code={t.code} w={40} h={29} cls={isTeamOut ? "is-elim" : undefined} />
              <div className="pi">
                <b>{t.name}{isTeamOut && <span className="elim-badge">OUT</span>}</b>
                <div className="tms">
                  {t.owners.length>0
                    ? <span className="t"><AvStack people={t.owners} size={30} max={4}/> <span style={{marginLeft:4}}>{t.owners.length} owner{t.owners.length!==1?"s":""}</span></span>
                    : <span className="t" style={{color:"var(--muted2)"}}>No owner</span>}
                </div>
              </div>
              {!hidePts && <div className="stat"><div className="pp">{t.pts}</div><small>pts</small></div>}
              <Icon.chev className="chev"/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- TEAM DETAIL ---------------- */
export function TeamDetail({ code, onBack, openMatch, openPerson, openUpload }) {
  useSpoiler();
  const t = S.team(code);
  const fixtures = S.fixtures.filter(f=>f.t1===code||f.t2===code);
  const pos = S.standings[t.group].findIndex(x=>x.code===code)+1;
  // a team's photos = approved photos tagged to any game this team plays in
  const photos = S.photos.filter(p=>{ const fx = S.fixture(p.fixtureId); return p.status==="approved" && fx && (fx.t1===code || fx.t2===code); });

  const isTeamOut = S.isTeamEliminated(code);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <header className="top" style={{padding:0,overflow:"visible"}}>
        <div className="team-banner" style={{paddingTop:14}}>
          <div className="bgflag" style={{backgroundImage:`url(${S.flag(code,320)})`}}></div>
          <div className="ov"></div>
          <div className="tb-inner">
            <div className="tb-top">
              <button className="backbtn" onClick={onBack}><Icon.back/></button>
              <Flag code={code} w={62} h={46} res={320} />
              <div className="tb-id" style={{flex:1, minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <h2 style={{margin:0}}>{t.name}</h2>
                  {isTeamOut ? (
                    <span className="elim-badge elim-badge-red" style={{fontSize:10,padding:"2px 7px",fontWeight:800,borderRadius:6,textTransform:"uppercase"}}>OUT</span>
                  ) : (
                    <span style={{background:"#dcfce7",color:"#15803d",border:"1px solid #bbf7d0",fontSize:10,padding:"2px 7px",fontWeight:800,borderRadius:6,textTransform:"uppercase"}}>ALIVE</span>
                  )}
                </div>
                <div className="meta">
                  <span className="b">Group {t.group}</span>
                  <span className="b">Pool {t.pool}</span>
                  <span className="b">{pos}{pos===1?"st":pos===2?"nd":pos===3?"rd":"th"} · {t.pts} pts</span>
                </div>
              </div>
              <button className="iconbtn" onClick={()=>openUpload(code)} aria-label="Add a fan photo"><Icon.camera/></button>
            </div>
          </div>
        </div>
      </header>

      <div className="scroll pad screen-anim">
        <div className="wrap" style={{marginTop:14}}>
          <div className="dh-stats" style={{marginTop:0}}>
            <div className="dh-stat" style={{background:"var(--card)",border:"1px solid var(--line)"}}><b style={{color:"var(--navy)"}}>{t.strength}</b><small style={{color:"var(--muted2)"}}>Strength</small></div>
            <div className="dh-stat" style={{background:"var(--card)",border:"1px solid var(--line)"}}><b style={{color:"var(--navy)"}}>{t.win}-{t.draw}-{t.loss}</b><small style={{color:"var(--muted2)"}}>W-D-L</small></div>
            <div className="dh-stat" style={{background:"var(--card)",border:"1px solid var(--line)"}}><b style={{color:"var(--navy)"}}>{S.gd(t)>0?"+":""}{S.gd(t)}</b><small style={{color:"var(--muted2)"}}>Goal diff</small></div>
          </div>

          <div className="sec-h"><h2>Owner{t.owners.length!==1?"s":""}</h2><span className="lnk">{t.outlook}</span></div>
          {t.owners.length>0 ? (
            <div className="owners-grid">
              {t.owners.map(p=>(
                <div className="ochip" key={p.id} onClick={()=>openPerson(p)}>
                  <PersonAvatar p={p} cls="av"/>
                  <b>{p.name}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="block" style={{padding:"16px 14px",textAlign:"center",color:"var(--muted)",fontSize:13}}>Nobody drew {t.name} in the sweep.</div>
          )}

          <div className="sec-h"><h2>Fixtures &amp; results</h2></div>
          <div className="block">
            {fixtures.map(f=>{
              const oppCode = f.t1===code?f.t2:f.t1;
              const r = resultFor(f, code);
              const live = f.status==="live";
              return (
                <div className="mini-fx" key={f.id} onClick={()=>openMatch(f)}>
                  <div className="fx-main">
                    <div className="opp"><Flag code={oppCode} w={24} h={18}/><span className="vs">v</span><span className="nm">{S.team(oppCode).name}</span></div>
                    <div className={"fx-when"+(live?" live":"")}>{whenLabel(f, S.vocab.ftShort)}</div>
                  </div>
                  <div className="rr">
                    {(f.status==="final"||live) && (spoilerHidden(f) ? <ScoreCover f={f}/> : (
                      <span className="sc">
                        {f.t1===code?f.score[0]:f.score[1]}–{f.t1===code?f.score[1]:f.score[0]}
                        {f.penScore && (() => {
                          const pSelf = f.t1===code ? f.penScore[0] : f.penScore[1];
                          const pOpp = f.t1===code ? f.penScore[1] : f.penScore[0];
                          return (
                            <span style={{ fontSize: 10, color: "var(--muted2)", marginLeft: 6, fontWeight: 700, fontFamily: "sans-serif" }}>
                              (
                              <span style={{ color: pSelf > pOpp ? "var(--navy)" : "inherit" }}>{pSelf}</span>
                              –
                              <span style={{ color: pOpp > pSelf ? "var(--navy)" : "inherit" }}>{pOpp}</span>
                              )
                            </span>
                          );
                        })()}
                      </span>
                    ))}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && f.hasOdds && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{(!S.competition.hasDraws || f.stage==="knockout"?f.prob2:f.prob3)[f.t1===code?"pa":"pb"]}%</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {t.squad?.length > 0 && <>
            <div className="sec-h"><h2>Squad</h2><span className="lnk">{t.squad.length} players</span></div>
            <div className="block" style={{padding:"6px 14px 12px"}}>
              <SquadList players={t.squad} wide/>
            </div>
          </>}

          <div className="sec-h"><h2>Fan photos</h2><span className="lnk" onClick={()=>openUpload(code)}>Add →</span></div>
          {photos.length>0 ? (
            <div className="photogrid">
              {photos.map(p=>(
                <div className="photocell" key={p.id}>
                  {p.src ? <img className="pcimg" src={p.src} alt={p.caption||"Fan photo"} loading="lazy"/> : <div className="lbl">FAN PHOTO</div>}
                  <div className="by">{p.caption} · {p.uploader.split(" ")[0]}</div>
                </div>
              ))}
              <div className="photocell" onClick={()=>openUpload(code)} style={{background:"var(--card)",border:"1.5px dashed var(--line)",display:"grid",placeItems:"center",cursor:"pointer"}}>
                <div style={{textAlign:"center",color:"var(--muted)"}}><Icon.camera style={{width:24,height:24,stroke:"var(--muted)"}}/><div style={{fontSize:11,fontWeight:700,marginTop:5}}>Add yours</div></div>
              </div>
            </div>
          ) : (
            <div className="dropzone" onClick={()=>openUpload(code)} style={{cursor:"pointer"}}>
              <div className="ic"><Icon.camera/></div>
              <b>Be the first {t.name} fan photo</b>
              <small>Upload a snap in team colours — approved by the admin before it shows.</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- UPLOAD FLOW ---------------- */
export function UploadSheet({ presetFixture, kind = "fan", onClose, onToast }) {
  useSpoiler();
  const me = getMe();
  const [name, setName] = useState(()=> me ? me.name : "");
  const [fixtureId, setFixtureId] = useState(presetFixture || null);
  const [q, setQ] = useState("");
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);
  const isProfile = kind === "profile";
  const ok = name.trim() && file && (isProfile ? !!me : !!fixtureId) && !busy;

  // taggable games: all fixtures in kickoff (start-time) order, searchable
  const games = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const matchup = (f) => `${S.team(f.t1).name} ${S.team(f.t2).name} ${f.city || ""}`.toLowerCase();
    return [...S.fixtures]
      .sort((a, b) => a.ko - b.ko)
      .filter((f) => !ql || matchup(f).includes(ql));
  }, [q]);
  const pickedFixture = fixtureId ? S.fixture(fixtureId) : null;

  // on open, scroll to today's first game — or the most recent game on/before today
  const scrollToId = useMemo(() => {
    const today = games.find((f) => f.dayKey === S.todayKey);
    if (today) return today.id;
    let prev = null;
    for (const f of games) { if (f.dayKey <= S.todayKey) prev = f; else break; }
    return (prev || games[0])?.id || null;
  }, [games]);
  const listRef = useRef(null);
  const targetRef = useRef(null);
  useEffect(() => {
    if (q.trim() || isProfile) return;
    const list = listRef.current, target = targetRef.current;
    if (list && target) list.scrollTop = Math.max(0, target.offsetTop - list.clientHeight / 2 + target.clientHeight / 2);
  }, [scrollToId, q, isProfile]);

  async function submit(){
    if (!ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("uploaderName", name.trim());
      if (isProfile) fd.append("personId", me.id); else fd.append("fixtureId", fixtureId);
      if (caption.trim()) fd.append("caption", caption.trim());
      fd.append("file", file);
      await uploadPhoto(fd);
      setDone(true);
    } catch (e) {
      onToast(/pending_exists|409/.test(String(e.message)) ? "You already have a photo awaiting approval" : "Upload failed — try again");
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"90%"}}>
        <div className="grab"></div>
        {!done ? (
          <>
            <div className="sheet-head"><h3>{isProfile ? "Upload profile photo" : "Add a fan photo"}</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
            {S.readOnly ? (
              <div className="sheet-body"><p style={{color:"var(--muted)",fontSize:13,textAlign:"center"}}>Uploads are paused while the sweep is read-only.</p></div>
            ) : (
            <div className="sheet-body">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>setFile(e.target.files?.[0]||null)} />
              <div className="dropzone" onClick={()=>inputRef.current&&inputRef.current.click()} style={{cursor:"pointer",borderColor:file?"var(--live)":"var(--line)",background:file?"#f1faf4":"var(--card)"}}>
                <div className="ic" style={{background:file?"#e7f6ee":"#eef1f5"}}>{file?<Icon.check style={{stroke:"var(--live)"}}/>:<Icon.camera/>}</div>
                <b>{file?file.name:"Tap to add a photo"}</b>
                <small>{file?"Looks good — ready to send":"JPG, PNG or WebP · up to 8 MB"}</small>
              </div>

              <div className="field" style={{marginTop:16}}>
                <label>Your name</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Macca" />
              </div>

              {!isProfile && (
                <div className="field">
                  <label>Tag a game</label>
                  <SearchInput value={q} onChange={setQ} placeholder="Search by team or matchup" />
                  <div className="gamepick" ref={listRef}>
                    {games.map((f)=>(
                      <button key={f.id} ref={f.id===scrollToId?targetRef:null} type="button" className={"gpk"+(fixtureId===f.id?" on":"")} onClick={()=>setFixtureId(f.id)}>
                        <span className="gpk-teams">
                          <Flag code={f.t1} w={22} h={16} />{S.team(f.t1).name}
                          <i>v</i>
                          <Flag code={f.t2} w={22} h={16} />{S.team(f.t2).name}
                        </span>
                        <span className="gpk-meta">{spoilerHidden(f) ? <Icon.eyeoff style={{width:13,height:13,stroke:"var(--muted2)"}}/> : f.status==="final"?(f.score?`${f.score[0]}–${f.score[1]}`:"FT"):f.status==="live"?"LIVE":whenLabel(f)}</span>
                      </button>
                    ))}
                    {games.length===0 && <div className="gpk-empty">No games match “{q}”.</div>}
                  </div>
                </div>
              )}

              <div className="note-line"><Icon.shield style={{stroke:"var(--live)"}}/><span>Every upload is checked by the admin before it appears anywhere. One pending photo per person at a time.</span></div>

              <button className={"cta"} onClick={submit} style={{marginTop:18,opacity:ok?1:.5}}>
                <Icon.camera/> {busy ? "Sending…" : "Send for approval"}
              </button>
            </div>
            )}
          </>
        ) : (
          <div className="success">
            <div className="ring"><Icon.check/></div>
            <h3>Sent for approval</h3>
            <p>Thanks{name?`, ${name.split(" ")[0]}`:""}! Your {isProfile ? "profile photo" : (pickedFixture?`${S.team(pickedFixture.t1).name} v ${S.team(pickedFixture.t2).name} `:"")+"photo"} is in the queue. The admin will approve it before it shows{isProfile ? " as your avatar." : " on the match and team pages."}</p>
            <button className="cta ghost" onClick={onClose} style={{marginTop:20}}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- MATCH DETAIL ---------------- */
/* fan-photo lightbox — opens an approved community photo "closer" */
export function PhotoLightbox({ photo, onClose, openMatch }) {
  if (!photo) return null;
  const fx = photo.fixtureId ? S.fixture(photo.fixtureId) : null;
  return (
    <div className="overlay lightbox" onClick={onClose}>
      <div className="lb-inner" onClick={e=>e.stopPropagation()}>
        <button className="lb-x" onClick={onClose} aria-label="Close"><Icon.x/></button>
        {photo.src
          ? <img className="lb-img" src={photo.src} alt={photo.caption||"Fan photo"}/>
          : <div className="lb-img lb-ph"><span>FAN PHOTO</span></div>}
        <div className="lb-meta">
          {fx && (
            <button className="lb-team" onClick={()=>{ onClose(); openMatch && openMatch(fx); }}>
              <Flag code={fx.t1} w={24} h={17} /><Flag code={fx.t2} w={24} h={17} />
              <span>{S.team(fx.t1).name} v {S.team(fx.t2).name}</span>
            </button>
          )}
          {photo.caption && <b>{photo.caption}</b>}
          <small>Posted by {photo.uploader}</small>
        </div>
      </div>
    </div>
  );
}
// A yellow/red card glyph (slim rounded rectangle) — cleaner than an emoji.
function CardChip({ red }) {
  return <span style={{ display: "inline-block", width: 10, height: 14, borderRadius: 2, flexShrink: 0, background: red ? "#e5483d" : "#f5c518", boxShadow: "0 1px 1.5px rgba(0,0,0,.25)" }} />;
}
function EventIcon({ e }) {
  if (e.type === "goal") return <span style={{ fontSize: 14, lineHeight: 1 }} aria-label="goal">⚽</span>;
  return <CardChip red={e.card === "red"} />;
}
// Two-sided broadcast timeline: home (t1) events on the left, away (t2) on the right,
// against a centre minute spine. Side = which team flag conveys who did what at a glance.
function MatchTimeline({ f }) {
  const [open, setOpen] = useState(true);
  const allEvents = f.events || [];
  const isShootoutEvent = (e) => isShootoutKick(f, e);
  const normalEvents = allEvents.filter(e => !isShootoutEvent(e)).slice().sort((x, y) => (x.minute ?? 0) - (y.minute ?? 0));
  if (normalEvents.length === 0) return null;
  if (spoilerHidden(f)) return null; // privacy mode: don't reveal goals/cards until the score is revealed
  const t1 = f.t1, t2 = f.t2;
  const tag = (e) => /penalty/i.test(e.detail || "") ? " (P)" : /own goal/i.test(e.detail || "") ? " (OG)" : "";
  const detail = (e, end) => (
    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, textAlign: end }}>
      <span><b style={{ fontWeight: 700 }}>{e.player}</b>{tag(e)}</span>
      {e.assist ? <span style={{ display: "block", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>assist · {e.assist}</span> : null}
    </span>
  );
  return (
    <>
      <button type="button" className="blocktitle squad-toggle" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "2px 2px 10px", width: "100%", background: "none", border: 0, textAlign: "left", display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
        <span>Match events</span>
        <Icon.chev style={{ width: 15, height: 15, marginLeft: "auto", transition: "transform .22s ease", transform: open ? "rotate(90deg)" : "none" }} />
      </button>
      <div className={"squad-collapse" + (open ? " open" : "")}>
        <div className="squad-collapse-inner">
          <div className="block" style={{ padding: "12px 10px", marginBottom: 16 }}>
            {/* spine + rows — sides mirror the scoreline above (home left, away right) */}
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: "var(--line)" }} />
              {normalEvents.map((e) => {
                const left = e.teamCode === t1;
                return (
                  <div key={e.id} style={{ position: "relative", display: "flex", alignItems: "flex-start", padding: "6px 0" }}>
                    <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "flex-start", gap: 7, paddingRight: 10, minWidth: 0 }}>
                      {left && <>{detail(e, "right")}<EventIcon e={e} /></>}
                    </div>
                    <div style={{ width: 34, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      <span style={{ background: "var(--card)", color: "var(--navy)", fontWeight: 800, fontSize: 12, fontVariantNumeric: "tabular-nums", padding: "1px 0", lineHeight: 1.3 }}>{e.minute}'</span>
                    </div>
                    <div style={{ flex: 1, display: "flex", justifyContent: "flex-start", alignItems: "flex-start", gap: 7, paddingLeft: 10, minWidth: 0 }}>
                      {!left && <><EventIcon e={e} />{detail(e, "left")}</>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PenaltyShootout({ f }) {
  const [open, setOpen] = useState(true);
  if (spoilerHidden(f)) return null;
  const allEvents = f.events || [];
  const isShootoutEvent = (e) => isShootoutKick(f, e);
  const shootoutEvents = allEvents.filter(e => isShootoutEvent(e));
  if (shootoutEvents.length === 0) return null;

  const t1 = f.t1, t2 = f.t2;
  const team1 = S.team(t1), team2 = S.team(t2);
  const attempts1 = shootoutEvents.filter(e => e.teamCode === t1);
  const attempts2 = shootoutEvents.filter(e => e.teamCode === t2);
  const maxRounds = Math.max(attempts1.length, attempts2.length);
  
  const isMiss = (e) => e && /miss|save/i.test(e.detail || "");
  
  const renderDot = (e) => {
    if (!e) return <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--line)", opacity: 0.5 }} />;
    const miss = isMiss(e);
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: miss ? "#e5483d" : "#30a46c",
        color: "#fff",
      }}>
        {miss ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ width: 9, height: 9 }}>
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        )}
      </span>
    );
  };

  return (
    <>
      <button type="button" className="blocktitle squad-toggle" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "2px 2px 10px", width: "100%", background: "none", border: 0, textAlign: "left", display: "flex", alignItems: "center", gap: 7, cursor: "pointer", marginTop: 12 }}>
        <span>Penalty shootout</span>
        <Icon.chev style={{ width: 15, height: 15, marginLeft: "auto", transition: "transform .22s ease", transform: open ? "rotate(90deg)" : "none" }} />
      </button>
      <div className={"squad-collapse" + (open ? " open" : "")}>
        <div className="squad-collapse-inner">
          <div className="block" style={{ padding: "16px 14px", marginBottom: 16 }}>
            {/* Visual Summary Row */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", width: 120, flexShrink: 0 }}>{team1.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {attempts1.map((e, idx) => <span key={idx}>{renderDot(e)}</span>)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", width: 120, flexShrink: 0 }}>{team2.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {attempts2.map((e, idx) => <span key={idx}>{renderDot(e)}</span>)}
                </div>
              </div>
            </div>

            {/* Detailed Takers List */}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {Array.from({ length: maxRounds }).map((_, idx) => {
                const e1 = attempts1[idx];
                const e2 = attempts2[idx];
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", fontSize: 12, padding: "4px 0" }}>
                    {/* Left Taker (Team 1) */}
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0, justifyContent: "flex-end", textAlign: "right" }}>
                      {e1 ? (
                        <>
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isMiss(e1) ? "var(--muted2)" : "var(--navy)" }}>{e1.player || team1.name}</span>
                          {renderDot(e1)}
                        </>
                      ) : <span style={{ color: "var(--muted2)" }}>—</span>}
                    </div>

                    {/* Round Label */}
                    <div style={{ width: 60, textAlign: "center", fontWeight: 700, color: "var(--muted)", fontSize: 10, textTransform: "uppercase" }}>
                      Round {idx + 1}
                    </div>

                    {/* Right Taker (Team 2) */}
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0, justifyContent: "flex-start", textAlign: "left" }}>
                      {e2 ? (
                        <>
                          {renderDot(e2)}
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isMiss(e2) ? "var(--muted2)" : "var(--navy)" }}>{e2.player || team2.name}</span>
                        </>
                      ) : <span style={{ color: "var(--muted2)" }}>—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
// Side-by-side per-team match statistics (shots, possession, corners, fouls), each a
// proportional bar — home red / away blue, matching the Official prediction bar. Hidden
// until the cache has a snapshot and (like the timeline) under privacy mode, since
// shots/possession telegraph who's on top.
const STAT_ROWS = [
  ['shotsOnGoal', 'Shots on Goal'],
  ['totalShots', 'Total Shots'],
  ['corners', 'Corner Kicks'],
  ['possession', 'Possession'],
  ['fouls', 'Fouls'],
];
const statNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const statText = (v) => (v == null ? '–' : String(v));

function MatchStats({ f }) {
  const [open, setOpen] = useState(true);
  const s1 = f.statistics?.[f.t1];
  const s2 = f.statistics?.[f.t2];
  if ((!s1 && !s2) || spoilerHidden(f)) return null;
  const rows = STAT_ROWS.filter(([k]) => (s1?.[k] != null) || (s2?.[k] != null));
  if (rows.length === 0) return null;
  return (
    <>
      <button type="button" className="blocktitle squad-toggle" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "2px 2px 10px", width: "100%", background: "none", border: 0, textAlign: "left", display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
        <span>Match statistics</span>
        <Icon.chev style={{ width: 15, height: 15, marginLeft: "auto", transition: "transform .22s ease", transform: open ? "rotate(90deg)" : "none" }} />
      </button>
      <div className={"squad-collapse" + (open ? " open" : "")}>
        <div className="squad-collapse-inner">
          <div className="block" style={{ padding: "14px 14px", marginBottom: 16 }}>
            {rows.map(([k, label]) => {
              const a = statNum(s1?.[k]), b = statNum(s2?.[k]);
              const tot = a + b;
              const pa = tot > 0 ? Math.round((a / tot) * 100) : 50;
              return (
                <div key={k} className="mstat">
                  <div className="mstat-top">
                    <span className="mstat-val">{statText(s1?.[k])}</span>
                    <span className="mstat-lbl">{label}</span>
                    <span className="mstat-val r">{statText(s2?.[k])}</span>
                  </div>
                  <div className="mstat-bar">
                    <div className="mstat-fill l" style={{ width: `${pa}%` }} />
                    <div className="mstat-fill r" style={{ width: `${100 - pa}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

export function MatchSheet({ f, onClose, onToast, openTeam, openPerson, openPhoto }) {
  useSocial();
  useSpoiler();
  const t1=S.team(f.t1), t2=S.team(f.t2), o=S.ownersForFixture(f);
  const showScore = f.status==="final"||f.status==="live";
  // open by default for a confirmed XI (the match-time highlight); collapsed for the squad fallback
  const [showSquad, setShowSquad] = useState(!!f.lineups?.length);
  const sup = supportOf(f.id);
  const mySup = mySupport(f.id);
  const matchPhotos = S.photos.filter(p=>p.fixtureId===f.id && p.status==="approved");
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"90%"}}>
        <div className="grab"></div>
        <div className="sheet-head">
          <h3>{f.status==="live"?"Live":f.status==="final"?S.vocab.finalLabel:"Upcoming"} · {f.group ? `${S.vocab.groupLabel} ${f.group}` : ''}</h3>
          <button className="x" onClick={onClose}><Icon.x/></button>
        </div>
        <div className="sheet-body">
          <div className="match-line" style={{padding:"4px 0 14px"}}>
            <div className="team" style={{flex:1}} onClick={()=>openTeam(f.t1)}>
              <Flag code={f.t1} w={56} h={42}/>
              <span className="nm" style={{color:"var(--navy)",fontSize:17}}>{t1.name}</span>
              <span className="mt-str">Strength {t1.strength}</span>
            </div>
            <div className="vs-cd" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {showScore
                ? (spoilerHidden(f) ? <ScoreCover f={f}/> : (
                    <span className="cd" style={{color:"var(--navy)",fontSize:34}}>{f.score[0]}<PenScore pen={f.penScore} side={0} />{f.penScore ? " – " : "–"}{f.score[1]}<PenScore pen={f.penScore} side={1} /></span>
                  ))
                : <span className="cd" style={{color:"var(--navy)",fontSize:20}}>{f.timeLabel}</span>}
              <span className="cdl" style={{color:"var(--muted2)", marginTop: 4}}>{f.status==="live"?[liveLabel(f), "LIVE"].filter(Boolean).join(" · "):f.status==="final"?"FULL TIME":f.dateTimeLabel}</span>
            </div>
            <div className="team" style={{flex:1}} onClick={()=>openTeam(f.t2)}>
              <Flag code={f.t2} w={56} h={42}/>
              <span className="nm" style={{color:"var(--navy)",fontSize:17}}>{t2.name}</span>
              <span className="mt-str">Strength {t2.strength}</span>
            </div>
          </div>

          <MatchTimeline f={f} />
          <PenaltyShootout f={f} />

          <MatchStats f={f} />

          {f.hasOdds && (
            <>
              <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>Official prediction</div>
              <div className="block" style={{padding:"15px 16px",marginBottom:16}}>
                {/* elimination matches (or no-draw sports): two-way "to progress" odds, no draw */}
                <div className="prob-bar" style={{background:"#eef1f5",height:12,borderRadius:7}}>
                  {!S.competition.hasDraws || f.stage==="knockout"
                    ? <><i className="a" style={{width:f.prob2.pa+"%"}}></i><i className="b" style={{width:f.prob2.pb+"%"}}></i></>
                    : <><i className="a" style={{width:f.prob3.pa+"%"}}></i><i className="d" style={{width:f.prob3.pd+"%"}}></i><i className="b" style={{width:f.prob3.pb+"%"}}></i></>}
                </div>
                <div className="prob-key" style={{color:"var(--muted)",marginTop:9}}>
                  {!S.competition.hasDraws || f.stage==="knockout"
                    ? <><span><b style={{color:"var(--navy)"}}>{f.prob2.pa}%</b> {t1.name}</span><span>{t2.name} <b style={{color:"var(--navy)"}}>{f.prob2.pb}%</b></span></>
                    : <><span><b style={{color:"var(--navy)"}}>{f.prob3.pa}%</b> {t1.name}</span><span><b style={{color:"var(--navy)"}}>{f.prob3.pd}%</b> Draw</span><span>{t2.name} <b style={{color:"var(--navy)"}}>{f.prob3.pb}%</b></span></>}
                </div>
              </div>
            </>
          )}

          {(() => {
            // confirmed XI (near kickoff) wins; otherwise fall back to the full squad
            const sheetFor = (code) => {
              const sq = S.team(code)?.squad || [];
              const lu = f.lineups?.find((l) => l.teamCode === code);
              if (lu) {
                // lineup players carry no photo — borrow the squad headshot, matched by shirt number
                const photoByNum = new Map(sq.map((p) => [p.number, p.photo]));
                const players = lu.startXI.map((p) => ({ ...p, photo: p.photo || photoByNum.get(p.number) || null }));
                return { formation: lu.formation, players };
              }
              return sq.length ? { formation: null, players: sq } : null;
            };
            const cols = [[f.t1, sheetFor(f.t1)], [f.t2, sheetFor(f.t2)]].filter(([, s]) => s);
            if (cols.length === 0) return null;
            const title = f.lineups?.length > 0 ? "Starting XI" : "Squads";
            return <>
              <button type="button" className="blocktitle squad-toggle" aria-expanded={showSquad}
                onClick={()=>setShowSquad(s=>!s)}
                style={{padding:"2px 2px 10px",width:"100%",background:"none",border:0,textAlign:"left",display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                <span>{title}</span>
                <Icon.chev style={{width:15,height:15,marginLeft:"auto",transition:"transform .22s ease",transform:showSquad?"rotate(90deg)":"none"}}/>
              </button>
              <div className={"squad-collapse" + (showSquad ? " open" : "")}>
                <div className="squad-collapse-inner">
                  <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"flex-start",paddingTop:2}}>
                    {cols.map(([code, sh])=>(
                      <div key={code} style={{flex:1,minWidth:0,background:"var(--card)",border:"1px solid var(--line)",borderRadius:12,padding:"11px"}}>
                        <div onClick={()=>openTeam(code)} style={{display:"flex",alignItems:"center",gap:7,marginBottom:9,cursor:"pointer"}}>
                          <Flag code={code} w={20} h={15} />
                          <b style={{fontFamily:"'Barlow Condensed'",fontWeight:700,fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{S.team(code)?.name || code}</b>
                          {sh.formation && <span style={{marginLeft:"auto",fontSize:12,color:"var(--muted)",fontWeight:700,letterSpacing:.4}}>{sh.formation}</span>}
                        </div>
                        <SquadList players={sh.players}/>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>;
          })()}

          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>Who's got a stake</div>
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            {[["t1",f.t1],["t2",f.t2]].map(([k,code])=>(
              <div key={k} style={{flex:1,background:"var(--card)",border:"1px solid var(--line)",borderRadius:12,padding:"11px"}}>
                <div onClick={()=>openTeam(code)} style={{display:"flex",alignItems:"center",gap:7,marginBottom:9,cursor:"pointer"}}><Flag code={code} w={20} h={15} /><b style={{fontFamily:"'Barlow Condensed'",fontWeight:700,fontSize:15}}>{S.team(code).name}</b></div>
                {o[k].length>0 ? o[k].map(p=>(
                  <div key={p.id} onClick={()=>openPerson(p)} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",cursor:"pointer"}}>
                    <PersonAvatar p={p} cls="av" style={{width:33,height:33,border:0,margin:0,fontSize:14}}/>
                    <span style={{fontSize:13,fontWeight:600}}>{p.short}</span>
                  </div>
                )) : <span style={{fontSize:12,color:"var(--muted2)",fontWeight:600}}>No owner</span>}
              </div>
            ))}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--muted)",fontWeight:600,marginBottom:16}}>
            <Icon.pin style={{width:15,height:15,stroke:"var(--muted)"}}/> {f.venue} · {f.city}
          </div>

          {/* back a team — locks once the match kicks off */}
          {(() => {
            const locked = f.status !== "upcoming";
            return <>
          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>{locked ? "Who'll win? · locked" : mySup ? "You're backing " + (mySup===DRAW ? "a draw" : S.team(mySup).name) : "Who'll win? · back a team"}</div>
          <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"stretch"}}>
            {[f.t1, ...(S.competition.hasDraws && f.stage==="group" ? [DRAW] : []), f.t2].map(code=>{
              const isDraw = code === DRAW;
              const label = isDraw ? "Draw" : S.team(code).name;
              const backers = sup[code] || [];
              const on = mySup===code;
              return (
                <button key={code} type="button" disabled={locked}
                  onClick={locked ? undefined : ()=>{ setSupport(f.id, code); onToast(on?"Support removed":"Backing "+label+" 📣"); }}
                  style={{flex:1,minWidth:0,textAlign:"left",display:"flex",flexDirection:"column",alignItems:"flex-start",background:on?"#fff6f3":"var(--card)",border:`1.5px solid ${on?"var(--accent)":"var(--line)"}`,borderRadius:12,padding:"11px",cursor:locked?"default":"pointer",transition:"border-color .15s, background .15s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:backers.length>0?9:3,width:"100%",minWidth:0}}>
                    {!isDraw && <Flag code={code} w={20} h={15} />}
                    <b style={{fontFamily:"'Barlow Condensed'",fontWeight:700,fontSize:15,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</b>
                  </div>
                  {backers.length>0
                    ? <div style={{width:"100%"}}>
                        {backers.map(p=>(
                          <div key={p.id} style={{display:"flex",alignItems:"center",gap:7,padding:"3px 0",minWidth:0}}>
                            <PersonAvatar p={p} cls="av" style={{width:24,height:24,border:0,margin:0,fontSize:11}}/>
                            <span style={{fontSize:12,fontWeight:600,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.short}</span>
                          </div>
                        ))}
                      </div>
                    : <span style={{fontSize:11.5,fontWeight:700,color:"var(--muted2)"}}>{locked ? "No backers" : "Tap to back"}</span>}
                </button>
              );
            })}
          </div>
            </>;
          })()}

          {matchPhotos.length>0 && <>
            <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>From the stands · {matchPhotos.length}</div>
            <div className="standshot" style={{marginBottom:16}}>
              {matchPhotos.map(p=>(
                <button key={p.id} type="button" className="standshot-item" onClick={()=>{ openPhoto && openPhoto(p); }}>
                  {p.src ? <img src={p.src} alt={p.caption||"Fan photo"} loading="lazy"/> : <span className="ph-ph">FAN PHOTO</span>}
                </button>
              ))}
            </div>
          </>}

        </div>
      </div>
    </div>
  );
}

/* ---------------- ADMIN ---------------- */

/* Resolve the TanStack query client: prefer an explicit prop (tests stub it),
   else the context client. Guarded like App.jsx — admin sub-components are unit-
   tested without a QueryClientProvider, where the hook would throw. */
function useResolvedQueryClient(override) {
  let hookQc = null;
  try { hookQc = useQueryClient(); } catch { hookQc = null; }
  return override || hookQc;
}

/* Host-aware admin gate. On the platform host the sweep_session cookie already
   carries role 'admin' (minted by the admin capability link) → unlock with no PIN.
   On the default host (sweepId 'default') keep the 4-digit PIN. A platform member
   with no admin link gets a "open your admin link" prompt. */
export function adminGateState(whoami) {
  if (whoami && whoami.role === 'admin') return 'unlocked';
  if (whoami && whoami.sweepId === 'default') return 'pin';
  return 'need-link';
}

export function AdminScreen({ onBack, onToast, openMatch }) {
  const [code, setCode] = useState("");
  const [gate, setGate] = useState(null); // null = checking; 'unlocked'|'pin'|'need-link'
  const [shake, setShake] = useState(false);

  useEffect(()=>{ fetchWhoami().then(w=>setGate(adminGateState(w))).catch(()=>setGate('pin')); },[]);

  function fail(){ setShake(true); setTimeout(()=>{ setShake(false); setCode(""); }, 400); }
  function press(d){
    if(code.length>=4) return;
    const nc = code + d; setCode(nc);
    if(nc.length===4){ setTimeout(async ()=>{ try { await adminLogin(nc); setGate('unlocked'); refreshAdminBadge(); } catch { fail(); } }, 120); }
  }
  function del(){ setCode(c=>c.slice(0,-1)); }

  if(gate===null) return <div style={{display:"flex",flexDirection:"column",height:"100%"}}><PageHeader title="Admin" sub="Restricted area" onBack={onBack} /></div>;

  if(gate==='need-link'){
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <PageHeader title="Admin" sub="Restricted area" onBack={onBack} />
        <div className="scroll pad screen-anim" style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:40}}>
          <div className="lockic"><Icon.lock/></div>
          <h3 style={{fontFamily:"'Barlow Condensed'",fontWeight:800,fontSize:20,textTransform:"uppercase",color:"var(--navy)"}}>Open your admin link</h3>
          <p style={{fontSize:12.5,color:"var(--muted)",marginTop:6,textAlign:"center",maxWidth:280}}>This sweep is admined from its admin link. Open the admin invite link on this device to manage it.</p>
        </div>
      </div>
    );
  }

  if(gate==='pin'){
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <PageHeader title="Admin" sub="Restricted area" onBack={onBack} />
        <div className="scroll passpad screen-anim" style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
          <div className="lockic"><Icon.lock/></div>
          <h3 style={{fontFamily:"'Barlow Condensed'",fontWeight:800,fontSize:20,textTransform:"uppercase",color:"var(--navy)"}}>Enter passcode</h3>
          <p style={{fontSize:12.5,color:"var(--muted)",marginTop:6,textAlign:"center"}}>Admin only.</p>
          <div className={"passdots"} style={{transform:shake?"translateX(0)":"none",animation:shake?"shake .4s":"none"}}>
            {[0,1,2,3].map(i=><i key={i} className={i<code.length?"f":""}></i>)}
          </div>
          <div className="keypad">
            {[1,2,3,4,5,6,7,8,9].map(n=><button key={n} className="key" onClick={()=>press(""+n)}>{n}</button>)}
            <button className="key blank"></button>
            <button className="key" onClick={()=>press("0")}>0</button>
            <button className="key blank" onClick={del} style={{fontSize:14,color:"var(--muted)"}}>⌫</button>
          </div>
        </div>
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
      </div>
    );
  }

  return <AdminConsole onBack={onBack} onToast={onToast} openMatch={openMatch} />;
}

export function AdminConsole({ onBack, onToast, openMatch }) {
  const [tab, setTab] = useState("people"); // 'people' | 'sweep' | 'mod'
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",flex:1,minHeight:0}}>
      <PageHeader title="Admin" sub="Manage your sweep" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />
      <div className="admintabs">
        <button className={"admintab"+(tab==="people"?" on":"")} onClick={()=>setTab("people")}>People</button>
        <button className={"admintab"+(tab==="sweep"?" on":"")} onClick={()=>setTab("sweep")}>Sweep</button>
        <button className={"admintab"+(tab==="mod"?" on":"")} onClick={()=>setTab("mod")}>Moderation</button>
      </div>
      {tab==="people" && <PeopleAdmin onToast={onToast} />}
      {tab==="sweep" && <SweepDraw onToast={onToast} />}
      {tab==="mod" && <AdminQueue embedded onToast={onToast} openMatch={openMatch} />}
    </div>
  );
}

// Avatar colours assigned to admin-created people (the add form collects only a
// name; av is required server-side). Stable per name via a simple char-sum hash.
const AV_PALETTE = ["#c9472f","#3b6fd1","#1f9d57","#b8860b","#7b4bd1","#0a9396","#bb3e03","#6a4c93"];

// Whole-sweep owner-count map so "allocate random" spreads teams evenly.
function ownerCounts() {
  const m = {};
  for (const t of S.teamList) m[t.code] = t.owners ? t.owners.length : 0;
  return m;
}
// Derive the display short-name + avatar initials from a person's name. Used both when
// creating a person and when renaming one, so short/initials never drift from the name.
function identityFromName(nm) {
  return { short: nm, initials: nm.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??" };
}
// Derive a stable avatar colour from a name (av is required server-side).
function avFor(nm) {
  return AV_PALETTE[Math.abs([...nm].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % AV_PALETTE.length];
}

// Compact flag chips for a person card, capped with a +N overflow.
function TeamChips({ codes, max = 8 }) {
  if (!codes.length) return <span className="tc-none">No teams yet</span>;
  const shown = codes.slice(0, max);
  const extra = codes.length - shown.length;
  return (
    <div className="tms tms-wrap">
      {shown.map((tc) => <span className="t tc-flag" key={tc}><Flag code={tc} w={22} h={16} /></span>)}
      {extra > 0 && <span className="t tc-more">+{extra}</span>}
    </div>
  );
}

// Searchable team list (.gpk). selected = Set of codes; hideCodes excluded from the list.
function TeamPicker({ selected, onToggle, hideCodes }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return S.teamList
      .filter((t) => !(hideCodes && hideCodes.has(t.code)))
      .filter((t) => !needle || t.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q, hideCodes]);
  return (
    <div className="field">
      <SearchInput value={q} onChange={setQ} placeholder="Search teams" />
      <div className="gamepick">
        {list.map((t) => (
          <button key={t.code} type="button" className={"gpk" + (selected.has(t.code) ? " on" : "")} onClick={() => onToggle(t.code)}>
            <span className="gpk-teams"><Flag code={t.code} w={22} h={16} />{t.name}</span>
            {selected.has(t.code) && <span className="gpk-meta"><Icon.check /></span>}
          </button>
        ))}
        {list.length === 0 && <div className="gpk-empty">No teams match “{q}”.</div>}
      </div>
    </div>
  );
}

// Add a new person + (optionally) allocate teams straight away.
function AddMemberSheet({ onClose, onToast, refresh }) {
  const [name, setName] = useState("");
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (c) => setSel((p) => { const n = new Set(p); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const allocate = (count) => {
    const codes = allocateRandomForPerson({ teams: [...sel] }, count, S.teamList, ownerCounts());
    setSel((p) => { const n = new Set(p); codes.forEach((c) => n.add(c)); return n; });
  };
  async function save() {
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      const created = await createPerson({ name: nm, ...identityFromName(nm), av: avFor(nm) });
      if (sel.size) await bulkPostOwnership([...sel].map((tc) => ({ personId: created.id, teamCode: tc })));
      onToast("Person added"); await refresh(); onClose();
    } catch { onToast("Couldn't add — try again"); setBusy(false); }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90%" }}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>Add person</h3><button className="x" onClick={onClose}><Icon.x /></button></div>
        <div className="sheet-body">
          <div className="field"><label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Macca" autoFocus />
          </div>
          <div className="alloc-rand">
            <span className="alloc-lbl">Allocate random</span>
            <button type="button" className="allocbtn" onClick={() => allocate(1)}>+1</button>
            <button type="button" className="allocbtn" onClick={() => allocate(2)}>+2</button>
            <button type="button" className="allocbtn" onClick={() => allocate(3)}>+3</button>
          </div>
          {sel.size > 0 && (
            <>
              <h4 className="adminsec-h alloc-h">Selected ({sel.size})</h4>
              <div className="tms tms-wrap alloc-chips">
                {[...sel].map((tc) => (
                  <button type="button" className="t t-chip" key={tc} onClick={() => toggle(tc)} aria-label={"Remove " + (S.team(tc)?.name || tc)}>
                    <Flag code={tc} w={20} h={14} />{S.team(tc)?.name || tc}<Icon.x />
                  </button>
                ))}
              </div>
            </>
          )}
          <h4 className="adminsec-h alloc-h">Add teams</h4>
          <TeamPicker selected={sel} onToggle={toggle} hideCodes={sel} />
          <button className="cta" disabled={busy || !name.trim()} onClick={save} style={{ marginTop: 14 }}>
            <Icon.check /> {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Show + allocate/reallocate/unallocate one person's teams; name is always editable
// and "Apply changes" commits the rename + team add/remove together (one round-trip).
function AllocateSheet({ person, onClose, onToast, refresh }) {
  const [adds, setAdds] = useState(new Set());      // brand-new teams to insert
  const [removes, setRemoves] = useState(new Set()); // owned teams to delete
  const [editName, setEditName] = useState(person.name);
  const [adult, setAdult] = useState(person.adult !== false); // wagers age gate
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => {
    const s = new Set(person.teams);
    removes.forEach((c) => s.delete(c));
    adds.forEach((c) => s.add(c));
    return s;
  }, [person.teams, adds, removes]);

  // add a team (un-stages a pending removal; only stages an add if it isn't already owned)
  const addTeam = (c) => {
    setRemoves((p) => { const n = new Set(p); n.delete(c); return n; });
    setAdds((p) => { if (person.teams.includes(c)) return p; const n = new Set(p); n.add(c); return n; });
  };
  const removeTeam = (c) => {
    if (adds.has(c)) { setAdds((p) => { const n = new Set(p); n.delete(c); return n; }); return; }
    setRemoves((p) => { const n = new Set(p); n.add(c); return n; });
  };
  const allocate = (count) => {
    const codes = allocateRandomForPerson({ teams: [...current] }, count, S.teamList, ownerCounts());
    codes.forEach(addTeam);
  };

  const nm = editName.trim();
  const nameChanged = !!nm && nm !== person.name;
  const adultChanged = adult !== (person.adult !== false);
  const dirty = nameChanged || adultChanged || adds.size > 0 || removes.size > 0;

  async function apply() {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      if (nameChanged || adultChanged) await patchPerson(person.id, { ...(nameChanged ? { name: nm, ...identityFromName(nm) } : {}), ...(adultChanged ? { adult } : {}) });
      const addItems = [...adds].map((tc) => ({ personId: person.id, teamCode: tc }));
      const removeItems = [...removes].map((tc) => ({ personId: person.id, teamCode: tc }));
      if (addItems.length) await bulkPostOwnership(addItems);
      if (removeItems.length) await bulkDeleteOwnership(removeItems);
      onToast("Changes saved"); await refresh(); onClose();
    } catch { onToast("Couldn't save — try again"); setBusy(false); }
  }
  async function removePerson() {
    if (busy) return;
    setBusy(true);
    try { await deletePerson(person.id); onToast("Person removed"); await refresh(); onClose(); }
    catch { onToast("Couldn't remove — try again"); setBusy(false); }
  }

  const currentCodes = [...current];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92%" }}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>Manage person</h3><button className="x" onClick={onClose}><Icon.x /></button></div>
        <div className="sheet-body">
          {/* identity: avatar + always-editable name + remove (single centered row) */}
          <div className="alloc-person">
            <PersonAvatar p={person} cls="pav alloc-av" />
            <input className="alloc-name-input" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Name" placeholder="Name" />
            <button className="alloc-remove" disabled={busy} onClick={removePerson} aria-label={"Remove " + person.name} title="Remove person"><Icon.trash /></button>
          </div>

          <div className="alloc-age">
            <div className="alloc-age-tx">
              <b>Wagers access</b>
              <small>18+ only — adults can use the wagering feature; minors can’t see it</small>
            </div>
            <button type="button" role="switch" aria-checked={adult} aria-label="Adult account (can use wagers)"
              className={"agetoggle" + (adult ? " on" : "")} onClick={() => setAdult(a => !a)}>
              {adult ? "Adult" : "Minor"}
            </button>
          </div>

          <h4 className="adminsec-h alloc-h">Teams ({currentCodes.length})</h4>
          <div className="tms tms-wrap alloc-chips">
            {currentCodes.length === 0 && <span className="tc-none">No teams yet</span>}
            {currentCodes.map((tc) => (
              <button type="button" className="t t-chip" key={tc} onClick={() => removeTeam(tc)} aria-label={"Unallocate " + (S.team(tc)?.name || tc)}>
                <Flag code={tc} w={20} h={14} />{S.team(tc)?.name || tc}<Icon.x />
              </button>
            ))}
          </div>

          <div className="alloc-rand">
            <span className="alloc-lbl">Allocate random</span>
            <button type="button" className="allocbtn" onClick={() => allocate(1)}>+1</button>
            <button type="button" className="allocbtn" onClick={() => allocate(2)}>+2</button>
            <button type="button" className="allocbtn" onClick={() => allocate(3)}>+3</button>
          </div>

          <h4 className="adminsec-h alloc-h">Add teams</h4>
          <TeamPicker selected={adds} onToggle={addTeam} hideCodes={current} />

          <button className="cta" disabled={busy || !dirty} onClick={apply} style={{ marginTop: 14, opacity: dirty ? 1 : 0.5 }}>
            <Icon.check /> {busy ? "Saving…" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PeopleAdmin({ onToast, queryClient }) {
  const qc = useResolvedQueryClient(queryClient);
  // Re-render whenever the sweep store updates (e.g. after a write refetch), so the
  // list reflects allocations without a manual reload — the ['sweep'] query's data
  // (syncStatus) can be unchanged, so we can't rely on it alone to re-render.
  const [, bump] = useState(0);
  useEffect(() => onSweepData(() => bump((n) => n + 1)), []);
  const people = S.people;
  const [sort, setSort] = useState("recent");
  const [adding, setAdding] = useState(false);
  const [allocId, setAllocId] = useState(null);

  const refresh = () => qc?.invalidateQueries({ queryKey: ["sweep"] });

  const sorted = useMemo(() => {
    const arr = people.slice();
    if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "teams") arr.sort((a, b) => b.teams.length - a.teams.length || a.name.localeCompare(b.name));
    else arr.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || a.name.localeCompare(b.name));
    return arr;
  }, [people, sort]);

  const allocPerson = allocId ? people.find((p) => p.id === allocId) : null;

  return (
    <div className="scroll pad screen-anim" style={{ paddingTop: 10 }}>
      <div className="wrap">
        <div className="adminadd alloc-row" style={{ justifyContent: "space-between" }}>
          <h3 className="adminsec-h" style={{ margin: 0 }}>People <span className="ct">{people.length}</span></h3>
          <button className="qbtn app" aria-label="Add person" title="Add person" onClick={() => setAdding(true)} style={{ minWidth: 0, width: 38, height: 38, padding: 0 }}><Icon.plus /></button>
        </div>
        <div className="filterbar" style={{ marginTop: 8 }}>
          <button className={"fchip" + (sort === "recent" ? " on" : "")} onClick={() => setSort("recent")}>Recently added</button>
          <button className={"fchip" + (sort === "name" ? " on" : "")} onClick={() => setSort("name")}>Name</button>
          <button className={"fchip" + (sort === "teams" ? " on" : "")} onClick={() => setSort("teams")}>Teams</button>
        </div>
        <div className="plist" style={{ marginTop: 12 }}>
          {sorted.map((p) => (
            <button className="prow prow-click" key={p.id} onClick={() => setAllocId(p.id)}>
              {p.adult === false && <span className="minor-badge">Minor</span>}
              {p.excluded && <span className="excl-badge" title="Self-excluded from Wagers"><Icon.shield />Excluded</span>}
              <PersonAvatar p={p} cls="pav" />
              <div className="pi" style={{ flex: 1, minWidth: 0 }}>
                <b>{p.name}</b>
                <TeamChips codes={p.teams} />
              </div>
              <div className="pcount"><b>{p.teams.length}</b><small>teams</small></div>
              <span className="chev"><Icon.chev /></span>
            </button>
          ))}
        </div>
      </div>
      {adding && <AddMemberSheet onClose={() => setAdding(false)} onToast={onToast} refresh={refresh} />}
      {allocPerson && <AllocateSheet person={allocPerson} onClose={() => setAllocId(null)} onToast={onToast} refresh={refresh} />}
    </div>
  );
}
// Wraps a My-Bets card so the admin audit reads identically to the player's own
// bet list, but tints + labels bets the settler can resolve right now ("stale").
function OpenItem({ stale, children }) {
  return (
    <div className={"ob-item"+(stale?" ob-item-stale":"")}>
      {stale && <div className="ob-needs"><Icon.bolt/> Needs settling</div>}
      {children}
    </div>
  );
}

// A person's open bets as an accordion: the header (avatar, name, open + stale
// counts, chevron) toggles a white card of the exact My-Bets bet cards.
function OpenBetsPerson({ g, expanded, onToggle, onMatch }) {
  const p = S.peopleById[g.person.id] || g.person;
  return (
    <div className="ob-person">
      <button className="ob-person-head" onClick={onToggle} aria-expanded={expanded}>
        <PersonAvatar p={p} cls="av" style={{width:30,height:30,border:0,margin:0,fontSize:12}}/>
        <b>{p.short||p.name}</b>
        <span className="ob-count">{g.openCount} open</span>
        <span className="ob-grow" />
        {g.staleCount>0 && <span className="ct ct-warn">{g.staleCount} stale</span>}
        <Icon.chev className={"ob-chev"+(expanded?" open":"")} />
      </button>
      {expanded && (
        <div className="block ob-list">
          {g.singles.map(b=><OpenItem key={b.id} stale={b.stale}><SingleBetRow b={b} onMatch={onMatch}/></OpenItem>)}
          {g.parlays.map(p=><OpenItem key={p.id} stale={p.stale}><ParlayCard p={p} onMatch={onMatch}/></OpenItem>)}
        </div>
      )}
    </div>
  );
}

export function AdminQueue({ onBack, onToast, embedded, openMatch }) {
  const [data, setData] = useState({ pending: [], approved: [] });
  const [open, setOpen] = useState({ people: [], totalOpen: 0, totalStale: 0 });
  const [openErr, setOpenErr] = useState(false);
  const [expanded, setExpanded] = useState({}); // personId → open in the accordion
  const [tab, setTab] = useState("pending");
  const [busy, setBusy] = useState(null);

  const [staleBusy, setStaleBusy] = useState(false);

  async function load(){ try { setData(await fetchAdminPhotos()); } catch { onToast("Couldn't load the queue"); } }
  // A failed audit fetch must NOT look like "all settled" — surface an error so the admin
  // never gets false reassurance from a reconciliation tool that simply didn't load.
  async function loadOpen(){
    try {
      setOpenErr(false);
      const d = await fetchOpenBets();
      setOpen(d);
      // auto-expand only the people who have something needing attention; collapse the rest.
      setExpanded(Object.fromEntries(d.people.filter(g=>g.staleCount>0).map(g=>[g.person.id, true])));
    } catch { setOpenErr(true); onToast("Couldn't load the open-bets audit"); }
  }
  useEffect(()=>{ load(); loadOpen(); },[]);

  const togglePerson = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));
  const openMatchBet = (fid) => { const fx = S.fixture(fid); if (fx && openMatch) openMatch(fx); };

  async function runSettleStale(){
    setStaleBusy(true);
    try {
      const { swept } = await settleStaleBets();
      onToast(swept>0 ? `Settled stale bets on ${swept} match${swept>1?"es":""}` : "No stale bets to settle");
      await loadOpen();
    } catch { onToast("Couldn't settle stale bets — try again"); }
    finally { setStaleBusy(false); }
  }

  const list = tab==="pending" ? data.pending : data.approved;

  async function act(id, action){
    setBusy(id);
    try {
      await moderatePhoto(id, action);
      onToast(action==="approve"?"Photo approved":action==="reject"?"Photo rejected":"Photo removed");
      await load();
      refreshAdminBadge();
    } catch { onToast("Action failed — try again"); }
    finally { setBusy(null); }
  }

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0,height:embedded?"auto":"100%"}}>
      {!embedded && <PageHeader title="Moderation" sub="Photo queue" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />}
      <div className="admintabs">
        <button className={"admintab"+(tab==="pending"?" on":"")} onClick={()=>setTab("pending")}>Pending {data.pending.length>0 && <span className="ct">{data.pending.length}</span>}</button>
        <button className={"admintab"+(tab==="approved"?" on":"")} onClick={()=>setTab("approved")}>Approved · {data.approved.length}</button>
        <button className={"admintab"+(tab==="open"?" on":"")} onClick={()=>setTab("open")}>Open bets {open.totalStale>0 ? <span className="ct ct-warn">{open.totalStale}</span> : (open.totalOpen>0 && <span className="ct">{open.totalOpen}</span>)}</button>
      </div>
      <div className="scroll pad screen-anim" style={{paddingTop:10}}>
        <div className="wrap">
          {tab==="open" ? (
            <>
              <div className="admin-maint">
                <div className="admin-maint-tx">
                  <b>Wagers upkeep</b>
                  <small>Settle any bets left open on matches that have already finished.</small>
                </div>
                <button className="cta ghost admin-maint-btn" disabled={staleBusy} onClick={runSettleStale}>
                  {staleBusy ? "Settling…" : "Settle stale bets"}
                </button>
              </div>
              {openErr
                ? <div className="empty"><div className="ic">⚠️</div><h3>Couldn’t load open bets</h3><p>The audit didn’t load — this isn’t a clean sweep. <button className="linklike" onClick={loadOpen}>Try again</button></p></div>
                : open.people.length===0
                ? <div className="empty"><div className="ic">✅</div><h3>No open bets</h3><p>Every wager has been settled.</p></div>
                : <>
                    {open.people.map(g=>(
                      <OpenBetsPerson key={g.person.id} g={g} expanded={!!expanded[g.person.id]} onToggle={()=>togglePerson(g.person.id)} onMatch={openMatchBet}/>
                    ))}
                    <div className="ob-tail" aria-hidden="true" />
                  </>}
            </>
          ) : (<>
          {list.length===0 && <div className="empty"><div className="ic">✅</div><h3>Queue clear</h3><p>No {tab} photos right now.</p></div>}
          {list.map(p=>(
            <div className="queueitem" key={p.id}>
              <div className="qimg" style={{backgroundImage:`url(${p.fileUrl})`,backgroundSize:"cover",backgroundPosition:"center"}}>
                <div className="lbl">{p.kind==="profile"?"PROFILE":"FAN PHOTO"}</div>
                {p.kind==="fan" && (()=>{ const fx=S.fixture(p.fixtureId); return fx ? <div className="tag"><Flag code={fx.t1} w={18} h={13} /><Flag code={fx.t2} w={18} h={13} /><span>{S.team(fx.t1)?.name} v {S.team(fx.t2)?.name}</span></div> : null; })()}
                {p.kind==="profile" && <div className="tag"><span>{S.peopleById[p.person]?.short || p.uploader}</span></div>}
              </div>
              <div className="qmeta"><b>{p.caption||"(no caption)"}</b><small>{p.uploader}</small></div>
              {tab==="pending" ? (
                <div className="qacts">
                  <button className="qbtn rej" disabled={busy===p.id} onClick={()=>act(p.id,"reject")}><Icon.x/> Reject</button>
                  <button className="qbtn app" disabled={busy===p.id} onClick={()=>act(p.id,"approve")}><Icon.check/> Approve</button>
                </div>
              ) : (
                <div className="qacts">
                  <button className="qbtn rej" disabled={busy===p.id} onClick={()=>act(p.id,"remove")} style={{flex:1}}><Icon.trash/> Remove from site</button>
                </div>
              )}
            </div>
          ))}
          </>)}
        </div>
      </div>
    </div>
  );
}
