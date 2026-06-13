/* ============================================================
   THE SWEEP — detail screens + flows
   ============================================================ */
import { useState, useEffect, useRef, useMemo } from "react";
import { SWEEP as S } from "./data.js";
import { whenLabel } from "./lib/format.js";
import {
  Icon, Flag, AvStack, PersonAvatar, MatchCard, PageHeader, SearchInput, SquadList, resultFor, useCountdown,
} from "./components.jsx";
import {
  useSocial, getMe, isWatching, toggleWatch,
  supportOf, mySupport, setSupport, watchersOf, DRAW,
  predictionsOf, predictionAccuracy,
} from "./social.js";
import { InstallButton } from "./InstallPrompt.jsx";
import { uploadPhoto, adminLogin, fetchAdminMe, fetchAdminPhotos, moderatePhoto } from "./api/client.js";
import { refreshAdminBadge } from "./admin.js";

/* ---------------- PEOPLE ---------------- */
export function PeopleScreen({ openPerson }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const list = ql
    ? S.money.filter(m => m.person.name.toLowerCase().includes(ql) || m.person.teams.some(tc => (S.team(tc)?.name || "").toLowerCase().includes(ql)))
    : S.money;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="People" sub={S.people.length + " in the sweep · sorted by team wins"} tall />
      <div className="scroll pad screen-anim" style={{paddingTop:14}}>
        <div className="wrap">
          <div style={{maxWidth:440,margin:"2px 0 14px"}}>
            <SearchInput value={q} onChange={setQ} placeholder="Search by name or team…" />
          </div>
          {list.length===0 && <p style={{fontSize:13,color:"var(--muted2)",padding:"8px 2px"}}>No one matches “{q}”.</p>}
          <div className="plist">
            {list.map(m=>{
              const p = m.person;
              return (
                <div className="prow" key={p.id} onClick={()=>openPerson(p)}>
                  <PersonAvatar p={p} cls="pav"/>
                  <div className="pi">
                    <b>{p.name}</b>
                    <div className="tms">{p.teams.map(tc=><span className="t" key={tc}><img className="flag" src={S.flag(tc,40)} alt=""/>{S.team(tc).name}</span>)}</div>
                  </div>
                  {m.wins > 0 && (
                    <div className="stat">
                      <div className="pp">{m.wins}</div>
                      <small style={{color:"var(--muted2)"}}>{m.wins===1?"win":"wins"}</small>
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
  const isMe = getMe()?.id === person.id;
  const myFixtures = S.fixtures.filter(f => person.teams.indexOf(f.t1)>=0 || person.teams.indexOf(f.t2)>=0);
  const next = myFixtures.filter(f=> f.status==="upcoming").sort((a,b)=>a.ko-b.ko)[0];
  const cd = next ? useCountdown(Math.max(0, Math.floor((next.ko.getTime() - Date.now())/1000))) : null;
  const money = S.money.find(m=>m.person.id===person.id);
  const myTeams = person.teams.map(c=>S.team(c));
  const played = myFixtures.filter(f=>f.status==="final");
  const wins = played.filter(f=>{ const r=resultFor(f, f.t1)===null?null:(person.teams.indexOf(f.t1)>=0?resultFor(f,f.t1):resultFor(f,f.t2)); return r==="w"; }).length;
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
              <div className="meta">In the money: <b style={{color:"#fff"}}>#{money.rank}</b> · {money.tag}</div>
            </div>
          </div>
          <div className="dh-stats">
            <div className="dh-stat"><b>{myTeams.length}</b><small>Teams drawn</small></div>
            <div className="dh-stat"><b>{played.length}</b><small>Games played</small></div>
            <div className="dh-stat"><b>{wins}</b><small>Wins</small></div>
            <div className="dh-stat"><b>{acc.correct}/{acc.total}</b><small>Calls right</small></div>
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
          {myTeams.map(t=>(
            <div className="teamtile" key={t.code} onClick={()=>openTeam(t.code)}>
              <div className="tcbar" style={{background:t.color}}></div>
              <img className="flag bigflag" src={S.flag(t.code,160)} alt=""/>
              <div className="ti">
                <b>{t.name}</b>
                <div className="sub"><span className="poolbadge">Pool {t.pool}</span><span>Group {t.group}</span><span>{t.outlook}</span></div>
              </div>
              <div className="wbox"><b>{t.strength}</b><small>Strength</small></div>
            </div>
          ))}

          <div className="sec-h"><h2>All their matches</h2></div>
          <div className="block">
            {myFixtures.map(f=>{
              const myCode = person.teams.indexOf(f.t1)>=0 ? f.t1 : f.t2;
              const oppCode = myCode===f.t1 ? f.t2 : f.t1;
              const r = resultFor(f, myCode);
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
                    <div className={"fx-when"+(live?" live":"")}>{whenLabel(f)}</div>
                  </div>
                  <div className="rr">
                    {(f.status==="final"||live) && <span className="sc">{myCode===f.t1?f.score[0]:f.score[1]}–{myCode===f.t1?f.score[1]:f.score[0]}</span>}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && f.hasOdds && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{f.prob3[myCode===f.t1?"pa":"pb"]}%</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sec-h"><h2>Prediction history</h2></div>
          <div className="block">
            {preds.length===0
              ? <div className="pred-empty">No predictions yet.</div>
              : preds.map(({f, pick, verdict})=>{
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
                        <div className={"fx-when"+(live?" live":"")}>{whenLabel(f)}</div>
                      </div>
                      <div className="rr">
                        {isDraw
                          ? <span className="pick-draw" title="Picked a draw" role="img" aria-label="Picked a draw">🤝</span>
                          : <span className="pick-flag" title={`Picked ${S.team(pick).name}`}><Flag code={pick} w={24} h={18}/></span>}
                        {verdict==="correct" && <span className="v-pill ok" title="Correct call">✓</span>}
                        {verdict==="wrong" && <span className="v-pill no" title="Wrong call">✗</span>}
                        {verdict===null && <span className="v-pill pending">pending</span>}
                      </div>
                    </div>
                  );
                })}
          </div>

          {isMe && <div style={{marginTop:22}}><InstallButton/></div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- TEAMS ---------------- */
export function TeamsScreen({ openTeam }) {
  const [mode, setMode] = useState("group"); // group | pool
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="Teams" sub="All 48 nations" tall />
      <div className="filterbar">
        <button className={"fchip"+(mode==="group"?" on":"")} onClick={()=>setMode("group")}>By World Cup group</button>
        <button className={"fchip"+(mode==="pool"?" on":"")} onClick={()=>setMode("pool")}>By sweep pool</button>
      </div>
      <div className="scroll pad screen-anim" style={{paddingTop:8}}>
        <div className="wrap">
          {mode==="group" ? S.groups.map(g=>(
            <TeamGroup key={g} title={"Group "+g} teams={S.standings[g]} openTeam={openTeam} rank />
          )) : ["A","B"].map(pool=>(
            <TeamGroup key={pool} title={"Pool "+pool} teams={S.teamList.filter(t=>t.pool===pool).sort((a,b)=>b.strength-a.strength)} openTeam={openTeam} />
          ))}
        </div>
      </div>
    </div>
  );
}
export function TeamGroup({ title, teams, openTeam, rank }) {
  useSocial();
  const me = getMe();
  const myTeams = me ? me.teams : [];
  return (
    <div style={{marginBottom:6}}>
      <div className="sec-h" style={{marginBottom:7}}><h2>{title}</h2></div>
      <div className="plist" style={{marginBottom:12}}>
        {teams.map((t,i)=>(
          <div className={"prow"+(myTeams.indexOf(t.code)>=0?" mine":"")} key={t.code} onClick={()=>openTeam(t.code)} style={{padding:"9px 12px"}}>
            {rank && <span className="pos" style={{width:14,fontFamily:"'Barlow Condensed'",fontWeight:800,color:i<2?"var(--live)":i===2?"var(--gold)":"var(--muted2)"}}>{i+1}</span>}
            <img className="flag" src={S.flag(t.code,160)} alt="" style={{width:40,height:29,borderRadius:5}}/>
            <div className="pi">
              <b>{t.name}</b>
              <div className="tms">
                {t.owners.length>0
                  ? <span className="t"><AvStack people={t.owners} size={30} max={4}/> <span style={{marginLeft:4}}>{t.owners.length} owner{t.owners.length!==1?"s":""}</span></span>
                  : <span className="t" style={{color:"var(--muted2)"}}>No owner</span>}
              </div>
            </div>
            <div className="stat"><div className="pp">{t.pts}</div><small>pts</small></div>
            <Icon.chev className="chev"/>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- TEAM DETAIL ---------------- */
export function TeamDetail({ code, onBack, openMatch, openPerson, openUpload }) {
  const t = S.team(code);
  const fixtures = S.fixtures.filter(f=>f.t1===code||f.t2===code);
  const pos = S.standings[t.group].findIndex(x=>x.code===code)+1;
  // a team's photos = approved photos tagged to any game this team plays in
  const photos = S.photos.filter(p=>{ const fx = S.fixture(p.fixtureId); return p.status==="approved" && fx && (fx.t1===code || fx.t2===code); });

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <header className="top" style={{padding:0,overflow:"visible"}}>
        <div className="team-banner" style={{paddingTop:14}}>
          <div className="bgflag" style={{backgroundImage:`url(${S.flag(code,320)})`}}></div>
          <div className="ov"></div>
          <div className="tb-inner">
            <div className="tb-top">
              <button className="backbtn" onClick={onBack}><Icon.back/></button>
              <img className="flag" src={S.flag(code,320)} alt=""/>
              <div className="tb-id" style={{flex:1, minWidth:0}}>
                <h2>{t.name}</h2>
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
                    <div className={"fx-when"+(live?" live":"")}>{whenLabel(f)}</div>
                  </div>
                  <div className="rr">
                    {(f.status==="final"||live) && <span className="sc">{f.t1===code?f.score[0]:f.score[1]}–{f.t1===code?f.score[1]:f.score[0]}</span>}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && f.hasOdds && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{f.prob3[f.t1===code?"pa":"pb"]}%</span>}
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
            <div className="sheet-body">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>setFile(e.target.files?.[0]||null)} />
              <div className="dropzone" onClick={()=>inputRef.current&&inputRef.current.click()} style={{cursor:"pointer",borderColor:file?"var(--live)":"var(--line)",background:file?"#f1faf4":"var(--card)"}}>
                <div className="ic" style={{background:file?"#e7f6ee":"#eef1f5"}}>{file?<Icon.check style={{stroke:"var(--live)"}}/>:<Icon.camera/>}</div>
                <b>{file?file.name:"Tap to add a photo"}</b>
                <small>{file?"Looks good — ready to send":"JPG, PNG or WebP · up to 8 MB"}</small>
              </div>

              <div className="field" style={{marginTop:16}}>
                <label>Your name</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Priya" />
              </div>

              {!isProfile && (
                <div className="field">
                  <label>Tag a game</label>
                  <SearchInput value={q} onChange={setQ} placeholder="Search by team or matchup" />
                  <div className="gamepick" ref={listRef}>
                    {games.map((f)=>(
                      <button key={f.id} ref={f.id===scrollToId?targetRef:null} type="button" className={"gpk"+(fixtureId===f.id?" on":"")} onClick={()=>setFixtureId(f.id)}>
                        <span className="gpk-teams">
                          <img src={S.flag(f.t1,40)} alt=""/>{S.team(f.t1).name}
                          <i>v</i>
                          <img src={S.flag(f.t2,40)} alt=""/>{S.team(f.t2).name}
                        </span>
                        <span className="gpk-meta">{f.status==="final"?(f.score?`${f.score[0]}–${f.score[1]}`:"FT"):f.status==="live"?"LIVE":whenLabel(f)}</span>
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
function WatchToggleCTA({ id, onToast }) {
  useSocial();
  const on = isWatching(id);
  return (
    <button className={"cta watch-cta" + (on?" on":"")} style={{flex:1}}
      onClick={()=>{ const ok = toggleWatch(id); if(ok && onToast) onToast(on ? "No longer watching" : "You're watching — visible to the group"); }}>
      {on ? <Icon.eyefill/> : <Icon.eye/>} {on ? "Watching" : "I'll be watching"}
    </button>
  );
}
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
              <img src={S.flag(fx.t1,40)} alt=""/><img src={S.flag(fx.t2,40)} alt=""/>
              <span>{S.team(fx.t1).name} v {S.team(fx.t2).name}</span>
            </button>
          )}
          {photo.caption && <b>{photo.caption}</b>}
          <small>Posted by {photo.uploader} · approved</small>
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
  const events = (f.events || []).slice().sort((x, y) => (x.minute ?? 0) - (y.minute ?? 0));
  if (events.length === 0) return null;
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
              {events.map((e) => {
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
export function MatchSheet({ f, onClose, onToast, openTeam, openPerson, openPhoto }) {
  useSocial();
  const t1=S.team(f.t1), t2=S.team(f.t2), o=S.ownersForFixture(f);
  const showScore = f.status==="final"||f.status==="live";
  // open by default for a confirmed XI (the match-time highlight); collapsed for the squad fallback
  const [showSquad, setShowSquad] = useState(!!f.lineups?.length);
  const sup = supportOf(f.id);
  const mySup = mySupport(f.id);
  const watchPeople = watchersOf(f.id);
  const matchPhotos = S.photos.filter(p=>p.fixtureId===f.id && p.status==="approved");
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"90%"}}>
        <div className="grab"></div>
        <div className="sheet-head">
          <h3>{f.status==="live"?"Live":f.status==="final"?"Full time":"Upcoming"} · Group {f.group}</h3>
          <button className="x" onClick={onClose}><Icon.x/></button>
        </div>
        <div className="sheet-body">
          <div className="match-line" style={{padding:"4px 0 14px"}}>
            <div className="team" style={{flex:1}} onClick={()=>openTeam(f.t1)}>
              <Flag code={f.t1} w={56} h={42}/>
              <span className="nm" style={{color:"var(--navy)",fontSize:17}}>{t1.name}</span>
              <span className="mt-str">Strength {t1.strength}</span>
            </div>
            <div className="vs-cd">
              {showScore
                ? <span className="cd" style={{color:"var(--navy)",fontSize:34}}>{f.score[0]}–{f.score[1]}</span>
                : <span className="cd" style={{color:"var(--navy)",fontSize:20}}>{f.timeLabel}</span>}
              <span className="cdl" style={{color:"var(--muted2)"}}>{f.status==="live"?f.minute+"' · LIVE":f.status==="final"?"FULL TIME":f.dateTimeLabel}</span>
            </div>
            <div className="team" style={{flex:1}} onClick={()=>openTeam(f.t2)}>
              <Flag code={f.t2} w={56} h={42}/>
              <span className="nm" style={{color:"var(--navy)",fontSize:17}}>{t2.name}</span>
              <span className="mt-str">Strength {t2.strength}</span>
            </div>
          </div>

          <MatchTimeline f={f} />

          {!showScore && f.hasOdds && (
            <>
              <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>Official prediction</div>
              <div className="block" style={{padding:"15px 16px",marginBottom:16}}>
                <div className="prob-bar" style={{background:"#eef1f5",height:12,borderRadius:7}}>
                  <i className="a" style={{width:f.prob3.pa+"%"}}></i><i className="d" style={{width:f.prob3.pd+"%"}}></i><i className="b" style={{width:f.prob3.pb+"%"}}></i>
                </div>
                <div className="prob-key" style={{color:"var(--muted)",marginTop:9}}><span><b style={{color:"var(--navy)"}}>{f.prob3.pa}%</b> {t1.name}</span><span><b style={{color:"var(--navy)"}}>{f.prob3.pd}%</b> Draw</span><span>{t2.name} <b style={{color:"var(--navy)"}}>{f.prob3.pb}%</b></span></div>
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
                          <img className="flag" src={S.flag(code,40)} style={{width:20,height:15}} alt=""/>
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
                <div onClick={()=>openTeam(code)} style={{display:"flex",alignItems:"center",gap:7,marginBottom:9,cursor:"pointer"}}><img className="flag" src={S.flag(code,40)} style={{width:20,height:15}} alt=""/><b style={{fontFamily:"'Barlow Condensed'",fontWeight:700,fontSize:15}}>{S.team(code).name}</b></div>
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
            {[f.t1, ...(f.stage==="group" ? [DRAW] : []), f.t2].map(code=>{
              const isDraw = code === DRAW;
              const label = isDraw ? "Draw" : S.team(code).name;
              const backers = sup[code] || [];
              const on = mySup===code;
              return (
                <button key={code} type="button" disabled={locked}
                  onClick={locked ? undefined : ()=>{ setSupport(f.id, code); onToast(on?"Support removed":"Backing "+label+" 📣"); }}
                  style={{flex:1,minWidth:0,textAlign:"left",display:"flex",flexDirection:"column",alignItems:"flex-start",background:on?"#fff6f3":"var(--card)",border:`1.5px solid ${on?"var(--accent)":"var(--line)"}`,borderRadius:12,padding:"11px",cursor:locked?"default":"pointer",transition:"border-color .15s, background .15s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:backers.length>0?9:3,width:"100%",minWidth:0}}>
                    {!isDraw && <img className="flag" src={S.flag(code,40)} style={{width:20,height:15,flexShrink:0}} alt=""/>}
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

          {/* who's watching — only while a game is still open to watch (upcoming) */}
          {!showScore && <>
          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>Who's watching{watchPeople.length>0 ? " · "+watchPeople.length : ""}</div>
          <div className="block" style={{padding:"11px 13px",marginBottom:16}}>
            {watchPeople.length>0 ? (
              <div style={{display:"flex",alignItems:"center",gap:11}}>
                <AvStack people={watchPeople} size={39} max={7}/>
                <span style={{fontSize:12.5,color:"var(--muted)",fontWeight:600,lineHeight:1.35}}>{watchPeople.map(p=>p.short).join(", ")} {watchPeople.length===1?"is":"are"} tuning in</span>
              </div>
            ) : <span style={{fontSize:12.5,color:"var(--muted2)",fontWeight:600}}>Nobody's marked this yet — be the first.</span>}
          </div>
          </>}

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

          {!showScore && <WatchToggleCTA id={f.id} onToast={onToast} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- ADMIN ---------------- */
export function AdminScreen({ onBack, onToast }) {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(()=>{ fetchAdminMe().then(()=>setUnlocked(true)).catch(()=>{}); },[]);

  function fail(){ setShake(true); setTimeout(()=>{ setShake(false); setCode(""); }, 400); }
  function press(d){
    if(code.length>=4) return;
    const nc = code + d; setCode(nc);
    if(nc.length===4){ setTimeout(async ()=>{ try { await adminLogin(nc); setUnlocked(true); refreshAdminBadge(); } catch { fail(); } }, 120); }
  }
  function del(){ setCode(c=>c.slice(0,-1)); }

  if(!unlocked){
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
  return <AdminQueue onBack={onBack} onToast={onToast} />;
}

export function AdminQueue({ onBack, onToast }) {
  const [data, setData] = useState({ pending: [], approved: [] });
  const [tab, setTab] = useState("pending");
  const [busy, setBusy] = useState(null);

  async function load(){ try { setData(await fetchAdminPhotos()); } catch { onToast("Couldn't load the queue"); } }
  useEffect(()=>{ load(); },[]);

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
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="Moderation" sub="Photo queue" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />
      <div className="admintabs">
        <button className={"admintab"+(tab==="pending"?" on":"")} onClick={()=>setTab("pending")}>Pending {data.pending.length>0 && <span className="ct">{data.pending.length}</span>}</button>
        <button className={"admintab"+(tab==="approved"?" on":"")} onClick={()=>setTab("approved")}>Approved · {data.approved.length}</button>
      </div>
      <div className="scroll pad screen-anim" style={{paddingTop:10}}>
        <div className="wrap">
          {list.length===0 && <div className="empty"><div className="ic">✅</div><h3>Queue clear</h3><p>No {tab} photos right now.</p></div>}
          {list.map(p=>(
            <div className="queueitem" key={p.id}>
              <div className="qimg" style={{backgroundImage:`url(${p.fileUrl})`,backgroundSize:"cover",backgroundPosition:"center"}}>
                <div className="lbl">{p.kind==="profile"?"PROFILE":"FAN PHOTO"}</div>
                {p.kind==="fan" && (()=>{ const fx=S.fixture(p.fixtureId); return fx ? <div className="tag"><img src={S.flag(fx.t1,40)} alt=""/><img src={S.flag(fx.t2,40)} alt=""/><span>{S.team(fx.t1)?.name} v {S.team(fx.t2)?.name}</span></div> : null; })()}
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
        </div>
      </div>
    </div>
  );
}
