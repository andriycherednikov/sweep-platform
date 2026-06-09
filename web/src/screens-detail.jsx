/* ============================================================
   THE SWEEP — detail screens + flows
   ============================================================ */
import { useState, useEffect, useRef } from "react";
import { SWEEP as S } from "./data.js";
import {
  Icon, Flag, AvStack, MatchCard, PageHeader, resultFor, useCountdown,
} from "./components.jsx";
import {
  useSocial, getMe, isWatching, toggleWatch,
  supportOf, mySupport, setSupport, watchersOf,
} from "./social.js";
import { uploadPhoto, adminLogin, fetchAdminMe, fetchAdminPhotos, moderatePhoto } from "./api/client.js";

/* ---------------- PEOPLE ---------------- */
export function PeopleScreen({ openPerson }) {
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="People" sub={S.people.length + " in the sweep · ranked by best team"} tall />
      <div className="scroll pad screen-anim" style={{paddingTop:14}}>
        <div className="wrap">
          <div className="plist">
            {S.money.map(m=>{
              const p = m.person;
              return (
                <div className="prow" key={p.id} onClick={()=>openPerson(p)}>
                  <span className="pav" style={{background:p.av}}>{p.initials}</span>
                  <div className="pi">
                    <b>{p.name}</b>
                    <div className="tms">{p.teams.map(tc=><span className="t" key={tc}><img className="flag" src={S.flag(tc,40)} alt=""/>{S.team(tc).name}</span>)}</div>
                  </div>
                  <div className="stat">
                    <div className="pp">#{m.rank}</div>
                    <small style={{color:m.rank===1?"var(--accent)":"var(--muted2)"}}>{m.tag}</small>
                  </div>
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
  const isMe = getMe()?.id === person.id;
  const myFixtures = S.fixtures.filter(f => person.teams.indexOf(f.t1)>=0 || person.teams.indexOf(f.t2)>=0);
  const next = myFixtures.filter(f=> f.status==="upcoming").sort((a,b)=>a.ko-b.ko)[0];
  const cd = next ? useCountdown(Math.max(60, Math.floor((next.ko - new Date("2026-06-13T08:00:00Z"))/1000) + 3*3600)) : null;
  const money = S.money.find(m=>m.person.id===person.id);
  const myTeams = person.teams.map(c=>S.team(c));
  const played = myFixtures.filter(f=>f.status==="final");
  const wins = played.filter(f=>{ const r=resultFor(f, f.t1)===null?null:(person.teams.indexOf(f.t1)>=0?resultFor(f,f.t1):resultFor(f,f.t2)); return r==="w"; }).length;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <header className="top" style={{padding:0,overflow:"visible"}}>
        <div className="detail-hero" style={{paddingTop:14}}>
          <div className="phead" style={{marginBottom:14}}>
            <button className="backbtn" onClick={onBack}><Icon.back/></button>
            <div className="spacer" style={{flex:1}}></div>
          </div>
          <div className="dh-person">
            <span className="pav" style={{background:person.av}}>{person.initials}</span>
            <div style={{minWidth:0}}>
              <h2>{person.name}</h2>
              <div className="meta">In the money: <b style={{color:"#fff"}}>#{money.rank}</b> · {money.tag}</div>
              {isMe && <button className="idchip dark" style={{marginTop:10}} onClick={()=>openProfileUpload && openProfileUpload()}><Icon.camera/> Upload profile photo</button>}
            </div>
          </div>
          <div className="dh-stats">
            <div className="dh-stat"><b>{myTeams.length}</b><small>Teams drawn</small></div>
            <div className="dh-stat"><b>{played.length}</b><small>Games played</small></div>
            <div className="dh-stat"><b>{wins}</b><small>Wins</small></div>
          </div>
        </div>
      </header>
      <div className="scroll pad screen-anim">
        <div className="wrap" style={{marginTop:16}}>
          {next && (
            <>
              <div className="sec-h"><h2>Next up</h2><span className="lnk">{cd.hms}</span></div>
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
              <div className="wbox"><b>{t.titleOdds}%</b><small>Title</small></div>
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
                  <div className={"when" + (live?" live":"")}>
                    <div className="t">{live? f.minute+"'" : f.status==="final" ? "FT" : f.timeLabel.replace(" ","")}</div>
                    <div className="d">{f.dayLabel.split(",")[0]}</div>
                  </div>
                  <div className="opp">
                    <Flag code={oppCode} w={24} h={18}/>
                    <span className="vs">v</span>
                    <span className="nm">{S.team(oppCode).name}</span>
                    {f.derby && <span className="derbydot" title="Community derby"></span>}
                  </div>
                  <div className="rr">
                    {(f.status==="final"||live) && <span className="sc">{myCode===f.t1?f.score[0]:f.score[1]}–{myCode===f.t1?f.score[1]:f.score[0]}</span>}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{f.prob[myCode===f.t1?"a":"b"]}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
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
  return (
    <div style={{marginBottom:6}}>
      <div className="sec-h" style={{marginBottom:7}}><h2>{title}</h2></div>
      <div className="plist" style={{marginBottom:12}}>
        {teams.map((t,i)=>(
          <div className="prow" key={t.code} onClick={()=>openTeam(t.code)} style={{padding:"9px 12px"}}>
            {rank && <span className="pos" style={{width:14,fontFamily:"'Barlow Condensed'",fontWeight:800,color:i<2?"var(--live)":i===2?"var(--gold)":"var(--muted2)"}}>{i+1}</span>}
            <img className="flag" src={S.flag(t.code,160)} alt="" style={{width:40,height:29,borderRadius:5}}/>
            <div className="pi">
              <b>{t.name}</b>
              <div className="tms">
                {t.owners.length>0
                  ? <span className="t"><AvStack people={t.owners} size={17} max={4}/> <span style={{marginLeft:4}}>{t.owners.length} owner{t.owners.length!==1?"s":""}</span></span>
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
  const photos = S.photos.filter(p=>p.team===code && p.status==="approved");

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <header className="top" style={{padding:0,overflow:"visible"}}>
        <div className="team-banner" style={{paddingTop:14}}>
          <div className="bgflag" style={{backgroundImage:`url(${S.flag(code,320)})`}}></div>
          <div className="ov"></div>
          <div className="tb-inner">
            <div className="phead" style={{marginBottom:14}}>
              <button className="backbtn" onClick={onBack}><Icon.back/></button>
              <div className="spacer" style={{flex:1}}></div>
              <button className="iconbtn" onClick={()=>openUpload(code)}><Icon.camera/></button>
            </div>
            <div className="tb-top">
              <img className="flag" src={S.flag(code,320)} alt=""/>
              <div>
                <h2>{t.name}</h2>
                <div className="meta">
                  <span className="b">Group {t.group}</span>
                  <span className="b">Pool {t.pool}</span>
                  <span className="b">{pos}{pos===1?"st":pos===2?"nd":pos===3?"rd":"th"} · {t.pts} pts</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="scroll pad screen-anim">
        <div className="wrap" style={{marginTop:14}}>
          <div className="dh-stats" style={{marginTop:0}}>
            <div className="dh-stat" style={{background:"var(--card)",border:"1px solid var(--line)"}}><b style={{color:"var(--navy)"}}>{t.titleOdds}%</b><small style={{color:"var(--muted2)"}}>Title odds</small></div>
            <div className="dh-stat" style={{background:"var(--card)",border:"1px solid var(--line)"}}><b style={{color:"var(--navy)"}}>{t.win}-{t.draw}-{t.loss}</b><small style={{color:"var(--muted2)"}}>W-D-L</small></div>
            <div className="dh-stat" style={{background:"var(--card)",border:"1px solid var(--line)"}}><b style={{color:"var(--navy)"}}>{S.gd(t)>0?"+":""}{S.gd(t)}</b><small style={{color:"var(--muted2)"}}>Goal diff</small></div>
          </div>

          <div className="sec-h"><h2>Owner{t.owners.length!==1?"s":""}</h2><span className="lnk">{t.outlook}</span></div>
          {t.owners.length>0 ? (
            <div className="owners-grid">
              {t.owners.map(p=>(
                <div className="ochip" key={p.id} onClick={()=>openPerson(p)}>
                  <span className="av" style={{background:p.av}}>{p.initials}</span>
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
                  <div className={"when"+(live?" live":"")}>
                    <div className="t">{live?f.minute+"'":f.status==="final"?"FT":f.timeLabel.replace(" ","")}</div>
                    <div className="d">{f.dayLabel.split(",")[0]}</div>
                  </div>
                  <div className="opp"><Flag code={oppCode} w={24} h={18}/><span className="vs">v</span><span className="nm">{S.team(oppCode).name}</span>{f.derby && <span className="derbydot"></span>}</div>
                  <div className="rr">
                    {(f.status==="final"||live) && <span className="sc">{f.t1===code?f.score[0]:f.score[1]}–{f.t1===code?f.score[1]:f.score[0]}</span>}
                    {r && <span className={"res-pill "+r}>{r.toUpperCase()}</span>}
                    {f.status==="upcoming" && <span className="num" style={{fontSize:12,color:"var(--muted)",fontWeight:700}}>{f.prob[f.t1===code?"a":"b"]}%</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sec-h"><h2>Fan photos</h2><span className="lnk" onClick={()=>openUpload(code)}>Add →</span></div>
          {photos.length>0 ? (
            <div className="photogrid">
              {photos.map(p=>(
                <div className="photocell" key={p.id}>
                  <div className="lbl">FAN PHOTO</div>
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
export function UploadSheet({ presetTeam, kind = "fan", onClose, onToast }) {
  const me = getMe();
  const [name, setName] = useState(()=> me ? me.name : "");
  const [team, setTeam] = useState(presetTeam || null);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);
  const isProfile = kind === "profile";
  const ok = name.trim() && file && (isProfile ? !!me : !!team) && !busy;

  async function submit(){
    if (!ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("uploaderName", name.trim());
      if (isProfile) fd.append("personId", me.id); else fd.append("teamCode", team);
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
                  <label>Tag a team</label>
                  <div className="teampick">
                    {S.teamList.filter(t=>t.owners.length>0).slice(0,18).map(t=>(
                      <button key={t.code} className={"tpk"+(team===t.code?" on":"")} onClick={()=>setTeam(t.code)}>
                        <img src={S.flag(t.code,80)} alt=""/><span>{t.name.length>9?t.name.slice(0,8)+"…":t.name}</span>
                      </button>
                    ))}
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
            <p>Thanks{name?`, ${name.split(" ")[0]}`:""}! Your {isProfile ? "profile photo" : (team?S.team(team).name:"")+" photo"} is in the queue. The admin will approve it before it shows{isProfile ? " as your avatar." : " on the team page and home banner."}</p>
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
export function MatchSheet({ f, onClose, onToast, openTeam, openPerson }) {
  useSocial();
  const t1=S.team(f.t1), t2=S.team(f.t2), o=S.ownersForFixture(f);
  const showScore = f.status==="final"||f.status==="live";
  const sup = supportOf(f.id);
  const mySup = mySupport(f.id);
  const watchPeople = watchersOf(f.id);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"90%"}}>
        <div className="grab"></div>
        <div className="sheet-head">
          <h3>{f.status==="live"?"Live":f.status==="final"?"Full time":"Upcoming"} · Group {f.group}</h3>
          <button className="x" onClick={onClose}><Icon.x/></button>
        </div>
        <div className="sheet-body">
          {f.derby && <div style={{display:"flex",alignItems:"center",gap:8,background:"#fff6f3",border:"1px solid #f3cabd",borderRadius:12,padding:"10px 13px",marginBottom:14}}>
            <span className="derby-tag" style={{flexShrink:0}}><span className="dot"></span> Derby</span>
            <span style={{fontSize:12.5,color:"#5a3a30",fontWeight:600,lineHeight:1.35}}>
              {f.doubleOwners.length>0
                ? <>Heads up — <b>{f.doubleOwners.map(p=>p.short).join(", ")}</b> own <i>both</i> sides of this one.</>
                : <>Community derby: <b>{o.t1.map(p=>p.short).join(", ")}</b> vs <b>{o.t2.map(p=>p.short).join(", ")}</b>.</>}
            </span>
          </div>}

          <div className="match-line" style={{padding:"4px 0 14px"}}>
            <div className="team" style={{flex:1}} onClick={()=>{onClose();openTeam(f.t1);}}>
              <Flag code={f.t1} w={56} h={42}/>
              <span className="nm" style={{color:"var(--navy)",fontSize:17}}>{t1.name}</span>
            </div>
            <div className="vs-cd">
              {showScore
                ? <span className="cd" style={{color:"var(--navy)",fontSize:34}}>{f.score[0]}–{f.score[1]}</span>
                : <span className="cd" style={{color:"var(--navy)",fontSize:20}}>{f.timeLabel}</span>}
              <span className="cdl" style={{color:"var(--muted2)"}}>{f.status==="live"?f.minute+"' · LIVE":f.status==="final"?"FULL TIME":"AEST · "+f.dayLabel}</span>
            </div>
            <div className="team" style={{flex:1}} onClick={()=>{onClose();openTeam(f.t2);}}>
              <Flag code={f.t2} w={56} h={42}/>
              <span className="nm" style={{color:"var(--navy)",fontSize:17}}>{t2.name}</span>
            </div>
          </div>

          {!showScore && (
            <div className="block" style={{padding:"13px",marginBottom:14}}>
              <div className="prob-bar" style={{background:"#eef1f5"}}>
                <i className="a" style={{width:f.prob.a+"%"}}></i><i className="d" style={{width:f.prob.d+"%",background:"#9aa1ad"}}></i><i className="b" style={{width:f.prob.b+"%"}}></i>
              </div>
              <div className="prob-key" style={{color:"var(--muted)"}}><span><b style={{color:"var(--navy)"}}>{f.prob.a}%</b> {t1.name}</span><span><b style={{color:"var(--navy)"}}>{f.prob.d}%</b> Draw</span><span>{t2.name} <b style={{color:"var(--navy)"}}>{f.prob.b}%</b></span></div>
            </div>
          )}

          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>Who's got a stake</div>
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            {[["t1",f.t1],["t2",f.t2]].map(([k,code])=>(
              <div key={k} style={{flex:1,background:"var(--card)",border:"1px solid var(--line)",borderRadius:12,padding:"11px"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}><img className="flag" src={S.flag(code,40)} style={{width:20,height:15}} alt=""/><b style={{fontFamily:"'Barlow Condensed'",fontWeight:700,fontSize:15}}>{S.team(code).name}</b></div>
                {o[k].length>0 ? o[k].map(p=>(
                  <div key={p.id} onClick={()=>{onClose();openPerson(p);}} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0"}}>
                    <span className="av" style={{background:p.av,width:22,height:22,border:0,margin:0,fontSize:9}}>{p.initials}</span>
                    <span style={{fontSize:13,fontWeight:600}}>{p.short}</span>
                  </div>
                )) : <span style={{fontSize:12,color:"var(--muted2)",fontWeight:600}}>No owner</span>}
              </div>
            ))}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--muted)",fontWeight:600,marginBottom:16}}>
            <Icon.pin style={{width:15,height:15,stroke:"var(--muted)"}}/> {f.venue} · {f.city}
          </div>

          {/* back a team */}
          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>{mySup ? "You're backing " + S.team(mySup).name : "Back a team"}</div>
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            {[f.t1,f.t2].map(code=>{
              const backers = sup[code] || [];
              const on = mySup===code;
              return (
                <button key={code} className={"backteam"+(on?" on":"")} onClick={()=>{ setSupport(f.id, code); onToast(on?"Support removed":"Backing "+S.team(code).name+" 📣"); }}>
                  <img className="flag" src={S.flag(code,80)} alt="" style={{width:30,height:22}}/>
                  <b>{S.team(code).name}</b>
                  <div className="bk">{backers.length>0 ? <><AvStack people={backers} size={20} max={5}/><span>{backers.length} backing</span></> : <span className="none">No backers yet</span>}</div>
                </button>
              );
            })}
          </div>

          {/* who's watching */}
          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>Who's watching{watchPeople.length>0 ? " · "+watchPeople.length : ""}</div>
          <div className="block" style={{padding:"11px 13px",marginBottom:16}}>
            {watchPeople.length>0 ? (
              <div style={{display:"flex",alignItems:"center",gap:11}}>
                <AvStack people={watchPeople} size={26} max={7}/>
                <span style={{fontSize:12.5,color:"var(--muted)",fontWeight:600,lineHeight:1.35}}>{watchPeople.map(p=>p.short).join(", ")} {watchPeople.length===1?"is":"are"} tuning in</span>
              </div>
            ) : <span style={{fontSize:12.5,color:"var(--muted2)",fontWeight:600}}>Nobody's marked this yet — be the first.</span>}
          </div>

          <div style={{display:"flex",gap:10}}>
            <WatchToggleCTA id={f.id} onToast={onToast} />
            <button className="cta ghost" style={{flex:1}} onClick={()=>{onToast("Shared to WhatsApp");onClose();}}><Icon.share/> Share</button>
          </div>
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
    if(nc.length===4){ setTimeout(async ()=>{ try { await adminLogin(nc); setUnlocked(true); } catch { fail(); } }, 120); }
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
                {p.kind==="fan" && p.team && <div className="tag"><img src={S.flag(p.team,40)} alt=""/><span>{S.team(p.team)?.name||p.team}</span></div>}
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
