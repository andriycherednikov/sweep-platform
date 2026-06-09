/* ============================================================
   THE SWEEP — app shell, routing, modals
   ============================================================ */
import { useState, useEffect, useRef } from "react";
import {
  Icon, BottomNav, Sidebar, IdentitySheet, useIsDesktop,
} from "./components.jsx";
import { setGlobalToast } from "./social.js";
import {
  HomeScreen, ScheduleScreen, StandingsScreen, KnockoutsScreen,
} from "./screens-main.jsx";
import {
  PeopleScreen, PersonDetail, TeamsScreen, TeamDetail,
  UploadSheet, MatchSheet, AdminScreen,
} from "./screens-detail.jsx";

export default function App() {
  const [tab, setTab] = useState("home");
  const [overlay, setOverlay] = useState(null);   // person | team | admin | knockouts
  const [modal, setModal] = useState(null);       // match | upload
  const [toast, setToast] = useState(null);
  const [identity, setIdentity] = useState(false);
  const toastTimer = useRef();

  function showToast(msg){ setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(()=>setToast(null), 1900); }
  useEffect(()=>{ setGlobalToast(showToast); window.__sweepPickMe = ()=>setIdentity(true); },[]);
  const go = (name) => { if (name==="upload"){ setModal({type:"upload",team:null}); return; } setOverlay(null); setTab(name); };
  const openPerson = (p) => setOverlay({ type:"person", person:p });
  const openTeam   = (c) => setOverlay({ type:"team", code:c });
  const openMatch  = (f) => setModal({ type:"match", f });
  const openUpload = (c) => setModal({ type:"upload", team:c||null });
  const openAdmin  = () => setOverlay({ type:"admin" });
  const openKnock  = () => setOverlay({ type:"knockouts" });
  const back = () => setOverlay(null);

  let base = null;
  if (tab==="home")      base = <HomeScreen go={go} openMatch={openMatch} openTeam={openTeam} openPerson={openPerson} onAdmin={openAdmin}/>;
  else if (tab==="schedule")  base = <ScheduleScreen openMatch={openMatch} openPerson={openPerson}/>;
  else if (tab==="people")    base = <PeopleScreen openPerson={openPerson}/>;
  else if (tab==="teams")     base = <TeamsScreen openTeam={openTeam}/>;
  else if (tab==="standings") base = <StandingsScreen openTeam={openTeam} openKnockouts={openKnock}/>;

  let ov = null, ovZ = 25;
  if (overlay) {
    if (overlay.type==="person")    ov = <PersonDetail person={overlay.person} onBack={back} openMatch={openMatch} openTeam={openTeam}/>;
    if (overlay.type==="team")      ov = <TeamDetail code={overlay.code} onBack={back} openMatch={openMatch} openPerson={openPerson} openUpload={openUpload}/>;
    if (overlay.type==="knockouts") ov = <KnockoutsScreen onBack={back}/>;
    if (overlay.type==="admin")   { ov = <AdminScreen onBack={back} onToast={showToast}/>; ovZ = 60; }
  }

  const isDesktop = useIsDesktop();
  const current = (overlay && (overlay.type==="knockouts" || overlay.type==="admin")) ? overlay.type : tab;
  const modals = (
    <>
      {modal && modal.type==="match" && <MatchSheet f={modal.f} onClose={()=>setModal(null)} onToast={showToast} openTeam={openTeam} openPerson={openPerson}/>}
      {modal && modal.type==="upload" && <UploadSheet presetTeam={modal.team} onClose={()=>setModal(null)} onToast={showToast}/>}
      {identity && <IdentitySheet onClose={()=>setIdentity(false)}/>}
      {toast && <div className="toast"><Icon.check/> {toast}</div>}
    </>
  );

  if (isDesktop) {
    return (
      <div className="deskwrap">
        <Sidebar current={current} go={go} onKnock={openKnock} onAdmin={openAdmin}/>
        <main className="deskmain">
          <div className="deskmain-rel">
            <div className={"deskscreen" + (tab==="standings" && !overlay ? " wide" : "")}>{base}</div>
            {ov && <div className="deskscreen" style={{zIndex:ovZ, background:"var(--bg)"}}>{ov}</div>}
          </div>
        </main>
        {modals}
      </div>
    );
  }

  return (
    <div className="viewport">
      <div style={{position:"relative", flex:1, display:"flex", flexDirection:"column", minHeight:0}}>
        {base}
        {ov && <div style={{position:"absolute", inset:0, background:"var(--bg)", zIndex:ovZ, display:"flex", flexDirection:"column", overflow:"hidden"}}>{ov}</div>}
      </div>
      <BottomNav tab={tab} go={go}/>
      {modals}
    </div>
  );
}
