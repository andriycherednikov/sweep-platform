/* ============================================================
   THE SWEEP — app shell, history-synced routing, modals
   ============================================================ */
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SWEEP as S } from "./data.js";
import {
  Icon, BottomNav, Sidebar, IdentitySheet, SweepsSheet, useIsDesktop,
} from "./components.jsx";
import { setGlobalToast, getMe } from "./social.js";
import { refreshAdminBadge } from "./admin.js";
import { FloatingReactions } from "./FloatingReactions.jsx";
import { InstallPrompt } from "./InstallPrompt.jsx";
import {
  HomeScreen, ScheduleScreen, StandingsScreen, KnockoutsScreen,
} from "./screens-main.jsx";
import {
  PeopleScreen, PersonDetail, TeamsScreen, TeamDetail,
  UploadSheet, MatchSheet, AdminScreen, PhotoLightbox,
} from "./screens-detail.jsx";
import { SuperConsole } from "./screens-super.jsx";
import { parseSuperRoute } from "./lib/superRoute.js";
import { initAnalytics, trackPageview, trackEvent } from "./lib/analytics.js";

const TABS = ["schedule", "people", "teams", "standings"];

/* nav state <-> URL. Modals/identity aren't deep-linked (kept in history.state only). */
function urlFor(v) {
  if (v.overlay?.type === "team") return `/teams/${v.overlay.code}`;
  if (v.overlay?.type === "person") return `/people/${v.overlay.id}`;
  if (v.overlay?.type === "knockouts") return "/knockouts";
  if (v.overlay?.type === "admin") return "/admin";
  if (v.overlay?.type === "sweeps") return "/sweeps";
  if (v.overlay?.type === "super") return v.overlay.token ? `/super/${v.overlay.token}` : "/super";
  return v.tab === "home" ? "/" : `/${v.tab}`;
}
function readView(path) {
  const seg = path.split("/").filter(Boolean);
  const base = { tab: "home", overlay: null, modal: null, identity: false };
  if (seg[0] === "teams" && seg[1]) return { ...base, tab: "teams", overlay: { type: "team", code: seg[1] } };
  if (seg[0] === "people" && seg[1]) return { ...base, tab: "people", overlay: { type: "person", id: seg[1] } };
  if (seg[0] === "knockouts") return { ...base, tab: "standings", overlay: { type: "knockouts" } };
  if (seg[0] === "admin") return { ...base, overlay: { type: "admin" } };
  if (seg[0] === "sweeps") return { ...base, overlay: { type: "sweeps" } };
  if (seg[0] === "super") return { ...base, overlay: { type: "super", token: parseSuperRoute(path).token } };
  return { ...base, tab: TABS.includes(seg[0]) ? seg[0] : "home" };
}

export default function App() {
  const [view, setView] = useState(() => readView(window.location.pathname));
  const [toast, setToast] = useState(null);
  const viewRef = useRef(view);
  const toastTimer = useRef();

  function showToast(msg){ setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(()=>setToast(null), 1900); }

  // forward navigation: merge a change into the view + push a history entry
  function navigate(partial) {
    const v = { ...viewRef.current, ...partial };
    viewRef.current = v;
    window.history.pushState(v, "", urlFor(v));
    setView(v);
  }
  const goBack = () => window.history.back(); // in-app back / close = browser back

  useEffect(() => {
    initAnalytics();
    setGlobalToast(showToast);
    window.__sweepPickMe = () => navigate({ identity: true });
    refreshAdminBadge(); // surfaces the moderation count if this device is an admin
    window.__sweepViewMe = () => { const me = getMe(); if (me) navigate({ overlay: { type: "person", id: me.id } }); };
    // seed the current entry with state so the first Back has something to restore
    window.history.replaceState(viewRef.current, "", urlFor(viewRef.current));
    const onPop = (e) => {
      const v = e.state || readView(window.location.pathname);
      viewRef.current = v;
      setView(v);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // SPA pageview: every view change (forward nav + popstate) is one virtual page.
  // Modals/overlays change `view` but not the URL (urlFor ignores them), so dedupe
  // on the resolved URL to avoid double-counting a modal open/close as pageviews.
  const prevUrlRef = useRef(null);
  useEffect(() => {
    const url = urlFor(view);
    if (url === prevUrlRef.current) return;
    prevUrlRef.current = url;
    trackPageview(url);
  }, [view]);

  const { tab, overlay, modal, identity } = view;

  const go = (name) => { if (name === "upload") { navigate({ modal: { type: "upload" } }); return; } navigate({ tab: name, overlay: null }); };
  // navigating to a person/team also closes any open modal in one history push
  // (calling onClose()=history.back() then navigate() races and clobbers the nav)
  const openPerson = (p) => navigate({ overlay: { type: "person", id: p.id }, modal: null });
  const openTeam   = (c) => navigate({ overlay: { type: "team", code: c }, modal: null });
  const openMatch  = (f) => { trackEvent("match_open", { match_id: f.id }); navigate({ modal: { type: "match", id: f.id } }); };
  const openPhoto  = (p) => navigate({ modal: { type: "photo", id: p.id } });
  const openUpload = () => navigate({ modal: { type: "upload" } });
  const openProfileUpload = () => navigate({ modal: { type: "upload", kind: "profile" } });
  const openAdmin  = () => navigate({ overlay: { type: "admin" } });
  const openKnock  = () => navigate({ overlay: { type: "knockouts" } });
  const openSuper  = () => navigate({ overlay: { type: "super" } });
  // Guarded: App.test.jsx renders <App/> without a QueryClientProvider, so the
  // hook would throw — fall back to null and let the sheet skip invalidation.
  let qc = null;
  try { qc = useQueryClient(); } catch (e) { qc = null; }
  const openSweeps = () => navigate({ overlay: { type: "sweeps" } });

  // resolve serializable ids back into the live objects the screens expect
  const person = overlay?.type === "person" ? S.peopleById[overlay.id] : null;
  const matchF = modal?.type === "match" ? S.fixtures.find((x) => x.id === modal.id) : null;
  const photoP = modal?.type === "photo" ? S.photos.find((x) => x.id === modal.id) : null;

  let base = null;
  if (tab==="home")      base = <HomeScreen go={go} openMatch={openMatch} openTeam={openTeam} openPerson={openPerson} openPhoto={openPhoto} onAdmin={openAdmin}/>;
  else if (tab==="schedule")  base = <ScheduleScreen openMatch={openMatch} openPerson={openPerson}/>;
  else if (tab==="people")    base = <PeopleScreen openPerson={openPerson}/>;
  else if (tab==="teams")     base = <TeamsScreen openTeam={openTeam}/>;
  else if (tab==="standings") base = <StandingsScreen openTeam={openTeam} openKnockouts={openKnock}/>;

  let ov = null, ovZ = 25;
  if (overlay?.type==="person" && person) ov = <PersonDetail person={person} onBack={goBack} openMatch={openMatch} openTeam={openTeam} openProfileUpload={openProfileUpload}/>;
  else if (overlay?.type==="team")      ov = <TeamDetail code={overlay.code} onBack={goBack} openMatch={openMatch} openPerson={openPerson} openUpload={openUpload}/>;
  else if (overlay?.type==="knockouts") ov = <KnockoutsScreen onBack={goBack}/>;
  else if (overlay?.type==="admin")   { ov = <AdminScreen onBack={goBack} onToast={showToast}/>; ovZ = 60; }
  else if (overlay?.type==="super")   { ov = <SuperConsole onBack={goBack} onToast={showToast} autoToken={overlay.token}/>; ovZ = 60; }

  const isDesktop = useIsDesktop();
  const current = (overlay && (overlay.type==="knockouts" || overlay.type==="admin" || overlay.type==="super")) ? overlay.type : tab;
  const modals = (
    <>
      {modal?.type==="match" && matchF && <MatchSheet f={matchF} onClose={goBack} onToast={showToast} openTeam={openTeam} openPerson={openPerson} openPhoto={openPhoto}/>}
      {modal?.type==="upload" && <UploadSheet presetFixture={modal.fixtureId} kind={modal.kind||"fan"} onClose={goBack} onToast={showToast}/>}
      {modal?.type==="photo" && photoP && <PhotoLightbox photo={photoP} onClose={goBack} openMatch={openMatch}/>}
      {identity && <IdentitySheet onClose={goBack}/>}
      {overlay?.type==="sweeps" && <SweepsSheet activeSweepId={S.sweep?.id ?? null} onClose={goBack} queryClient={qc}/>}
      <FloatingReactions/>
      {toast && <div className="toast"><Icon.check/> {toast}</div>}
    </>
  );

  if (isDesktop) {
    return (
      <div className="deskwrap">
        <Sidebar current={current} go={go} onKnock={openKnock} onAdmin={openAdmin} onSweeps={openSweeps}/>
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
      <InstallPrompt/>
      <BottomNav tab={tab} go={go}/>
      {modals}
    </div>
  );
}
