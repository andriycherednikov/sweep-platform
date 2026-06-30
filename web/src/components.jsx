/* ============================================================
   THE SWEEP — shared components
   ============================================================ */
import { useState, useEffect, useRef, useMemo } from "react";
import { SWEEP as S, useSweep, canModerate } from "./data.js";
import {
  useSocial, getMe, setMe, toast,
  supportOf, mySupport, setSupport, DRAW,
} from "./social.js";
import { useAdminBadge } from "./admin.js";
import { fmtDate } from "./lib/format.js";
import { listSweeps, removeSweep, renameSweep, switchTo, useSweeps } from "./sweeps.js";
import { postLogout } from "./api/client.js";
import { useSpoiler, spoilerHidden, reveal as revealScore } from "./spoiler.js";
import { canWager } from "./coins.js";
import { useOptOut } from "./optout.js";

export { useSocial, getMe, setMe };

/* ---- icons ---- */
export const Icon = {
  home:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>,
  cal:     (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>,
  people:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14.6c2.6.2 4.5 2.1 4.5 4.9"/></svg>,
  globe:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 000 18M3 12h18M5 7h14M5 17h14"/></svg>,
  ball:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8.6 15.2 11 14 14.8 10 14.8 8.8 11Z"/><path d="M12 8.6V3M15.2 11l5.4-1.8M14 14.8l3.3 4.5M10 14.8l-3.3 4.5M8.8 11 3.4 9.2"/></svg>,
  bars:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M5 21V9M12 21V4M19 21v-7"/></svg>,
  back:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M15 5l-7 7 7 7"/></svg>,
  chev:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M9 5l7 7-7 7"/></svg>,
  swap:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/></svg>,
  x:       (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>,
  check:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 12l5 5L20 6"/></svg>,
  plus:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}><path d="M12 5v14"/><path d="M5 12h14"/></svg>,
  share:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="6" cy="12" r="2.4"/><circle cx="17" cy="6" r="2.4"/><circle cx="17" cy="18" r="2.4"/><path d="M8 11l7-4M8 13l7 4"/></svg>,
  filter:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M3 5h18M6 12h12M10 19h4"/></svg>,
  camera:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.4"/></svg>,
  lock:    (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>,
  shield:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>,
  trash:   (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>,
  pin:     (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>,
  bolt:    (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>,
  eye:     (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>,
  eyeoff:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0112 5c6 0 10 7 10 7a18.4 18.4 0 01-3.2 4M6.7 6.7A18.4 18.4 0 002 12s4 7 10 7a10.8 10.8 0 004.3-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>,
  search:  (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>,
  eyefill: (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="#fff"/></svg>,
  thumb:   (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M2 9.5h3.5V21H2zM21.6 9.2A2 2 0 0020 8.4h-5.1l.77-3.7.02-.32a1.5 1.5 0 00-.44-1.06L14.4 2.5 8.2 8.7a2 2 0 00-.6 1.4V19a2 2 0 002 2h7.3a2 2 0 001.86-1.27l2.27-6.3a2 2 0 00.07-.5V11a2 2 0 00-.5-1.8z"/></svg>,
  star:    (p)=> <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 21.2l1.4-6.8L2.2 9.8l6.9-.7z"/></svg>,
  spinner: (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}><path d="M12 3a9 9 0 1 0 9 9"/></svg>,
  coin:    (p)=> <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  tickets: (p)=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" {...p}><rect x="7" y="3.6" width="13.4" height="9.2" rx="2"/><rect x="3.6" y="9.8" width="13.4" height="10.6" rx="2" fill="var(--card)"/><path d="M10.1 9.8v10.6" strokeDasharray="1.3 1.7"/></svg>
};

/* a person's owned teams — flag + name for ≤2, compact flags + count once there are more */
export function PersonTeams({ codes, hideEliminated }) {
  if (!codes || codes.length === 0) return null;
  const list = hideEliminated ? codes.filter(tc => !S.isTeamEliminated(tc)) : codes;
  if (list.length === 0) return null;
  if (list.length <= 2) {
    return (
      <div className="tms">
        {list.map((tc) => {
          const elim = S.isTeamEliminated(tc);
          return (
            <span className={"t" + (elim ? " is-elim" : "")} key={tc}>
              <img className={"flag" + (elim ? " is-elim" : "")} src={S.flag(tc, 40)} alt="" />
              {S.team(tc)?.name || tc}
            </span>
          );
        })}
      </div>
    );
  }
  return (
    <div className="tms tms-flags">
      {list.map((tc) => {
        const elim = S.isTeamEliminated(tc);
        return <img className={"flag" + (elim ? " is-elim" : "")} key={tc} src={S.flag(tc, 40)} alt={S.team(tc)?.name || tc} />;
      })}
      <span className="tms-count">· {list.length} teams</span>
    </div>
  );
}

/* spoiler protection: a tap-to-reveal cover shown in place of a hidden score */
export function ScoreCover({ f, dark }) {
  function click(e){ e.stopPropagation(); revealScore(f.id); }
  return (
    <button type="button" className={"spoiler-cover" + (dark ? " dark" : "")} onClick={click}
      aria-label="Reveal score" title="Tap to reveal score">
      <Icon.eyeoff/>
    </button>
  );
}

/* spoiler protection toggle — pill in the desktop sidebar, round icon in mobile headers */
export function SpoilerToggle({ compact }) {
  const { on, setSpoiler } = useSpoiler();
  const Ic = on ? Icon.eyeoff : Icon.eye;
  const label = "Privacy mode " + (on ? "on" : "off");
  if (compact) {
    return (
      <button type="button" className={"spoiler-tog compact" + (on ? " on" : "")} onClick={()=>setSpoiler(!on)}
        aria-pressed={on} aria-label={label} title={label}
        style={{width:30,height:30,borderRadius:9,background: on ? "var(--accent)" : "rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}>
        <Ic style={{width:15,height:15,stroke: on ? "#fff" : "#9fb6d6"}}/>
      </button>
    );
  }
  return (
    <button type="button" className={"privtog" + (on ? " on" : "")} onClick={()=>setSpoiler(!on)}
      aria-pressed={on} aria-label={label}>
      <Ic/>
      <span className="pt-label">Privacy mode</span>
      <span className="pt-state">{on ? "On" : "Off"}</span>
    </button>
  );
}

/* Wagers self-exclusion entry point — a discreet round shield button that opens
   the opt-out sheet (CoinsScreen owns that sheet). Replaces the privacy eye in the
   Wagers header only; not an eye, to read as self-care rather than spoiler control. */
export function OptOutButton({ onClick }) {
  return (
    <button type="button" onClick={onClick}
      aria-label="Step away from Wagers" title="Step away from Wagers"
      style={{width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}>
      <Icon.shield style={{width:15,height:15,stroke:"#9fb6d6"}}/>
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
  const [broken, setBroken] = useState(false);
  if (!p) return null;
  // Fall back to the coloured-initials avatar if the photo is missing or fails to load.
  if (p.avatarPath && !broken)
    return <img className={cls} src={p.avatarPath} alt={p.initials || ""} style={{ objectFit: "cover", ...style }} onError={() => setBroken(true)} />;
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

/* probability bar (hero) — three-way home / draw / away (official odds) */
export function ProbBar({ prob3 }) {
  const pa = prob3?.pa ?? 34, pd = prob3?.pd ?? 33, pb = Math.max(0, 100 - pa - pd); // last fills remainder
  return (
    <div className="prob">
      <div className="prob-bar">
        <i className="a" style={{ width: pa+"%" }}></i>
        <i className="d" style={{ width: pd+"%" }}></i>
        <i className="b" style={{ width: pb+"%" }}></i>
      </div>
    </div>
  );
}

/* squad / starting-XI list — players grouped by position bucket, with headshots */
const POS_BUCKET = (pos) => {
  const p = (pos || "").toLowerCase();
  if (p[0] === "g") return 0;        // Goalkeeper / G
  if (p[0] === "d") return 1;        // Defender / D
  if (p[0] === "m") return 2;        // Midfielder / M
  return 3;                          // Attacker / F (and anything else)
};
const POS_LABEL = ["Goalkeepers", "Defenders", "Midfielders", "Forwards"];
export function SquadList({ players, wide }) {
  if (!players || players.length === 0) return null;
  const groups = [[], [], [], []];
  players.forEach((p) => groups[POS_BUCKET(p.pos)].push(p));
  return (
    <div className={"squadlist" + (wide ? " wide" : "")}>
      {groups.map((grp, bi) => grp.length > 0 && (
        <div className="squad-grp" key={bi}>
          <div className="squad-grp-h">{POS_LABEL[bi]}</div>
          <div className="squad-grp-rows">
            {grp.map((pl, i) => (
              <div className="squad-row" key={i}>
                {pl.photo
                  ? <img className="squad-ph" src={pl.photo} alt="" loading="lazy"/>
                  : <span className="squad-ph squad-ph-ph">{pl.number ?? "–"}</span>}
                <span className="squad-num">{pl.number ?? "–"}</span>
                <span className="squad-nm">{pl.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* status pill for a fixture */
export function StatusPill({ f }) {
  if (f.status === "live") return <span className="pill live"><span className="b"></span> Live · {f.minute}'</span>;
  if (f.status === "final") return <span className="pill final">Full time</span>;
  return <span className="pill up">Upcoming</span>;
}

/* Inline penalty-shootout tally, shown right after a combined regulation score: "1 – 1 (4–3)".
   Winner's tally in navy. Replaces the old stacked "Penalties: x-y" line. */
export function PenScore({ pen, size = 11.5 }) {
  if (!pen) return null;
  return (
    <span style={{ fontSize: size, color: "var(--muted2)", marginLeft: 5, fontWeight: 700, whiteSpace: "nowrap", fontFamily: "sans-serif" }}>
      (<span style={{ color: pen[0] > pen[1] ? "var(--navy)" : "inherit" }}>{pen[0]}</span>–<span style={{ color: pen[1] > pen[0] ? "var(--navy)" : "inherit" }}>{pen[1]}</span>)
    </span>
  );
}

/* W/D/L result pill from a team's perspective */
export function resultFor(f, code) {
  if (f.status !== "final") return null;
  // winnerCode wins (incl. penalty shootouts), but 'DRAW' is the no-winner sentinel —
  // fall through to the score compare so a level final reads as a draw, not a loss for both.
  if (f.winnerCode && f.winnerCode !== "DRAW") {
    return f.winnerCode === code ? "w" : "l";
  }
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
  const showDraw = f.stage === "group";
  const c1 = (sup[f.t1]||[]).length, c2 = (sup[f.t2]||[]).length, cd = (sup[DRAW]||[]).length;
  const total = c1 + c2 + (showDraw ? cd : 0);
  // once a match starts, calls lock — nothing to show if nobody called it
  if (locked && total === 0) return null;
  const call = (code, name) => (e) => {
    e.stopPropagation();
    if (locked) { if (onToast) onToast("Voting is closed 🔒"); return; }
    const on = mine===code;
    setSupport(f.id, code);
    if (onToast) onToast(on ? "Call removed" : "You're calling "+name+" 👍");
  };
  const pickName = (code) => code === DRAW ? "Draw" : S.team(code).name;

  // one tappable tally bar: each zone grows with its vote count but keeps a
  // minimum tappable width (flex-basis:0 + min-width in css), so a zone with
  // few/no votes never collapses out of reach. selection = the zone fills with
  // its bold colour (others stay light) — no border/checkmark needed.
  const zone = (code, name, variant, count) => (
    <button type="button" key={code} aria-disabled={locked || undefined}
      className={"cz cz-"+variant+(mine===code?" on":"")} aria-pressed={mine===code}
      aria-label={(locked ? name : "Call "+name) + (total ? ", "+count+(count===1?" pick":" picks") : "")}
      title={locked ? name : "Call "+name}
      style={{ flexGrow: total ? count : 1 }}
      onClick={call(code, name)}>
      {code === DRAW
        ? <span className="cz-nm">{name}</span>
        : <Flag code={code} w={27} h={18} cls="cz-flag" />}
      {total > 0 && <span className="cz-ct">{count}</span>}
    </button>
  );

  return (
    <div className={"crowd"+(light?" light":"")+(locked?" locked":"")} onClick={e=>e.stopPropagation()}>
      <span className="crowd-lbl">Who'll win?{locked
        ? <span className="crowd-lock"><Icon.lock/> Closed</span>
        : (!mine ? <span className="crowd-hint"> · tap to vote</span> : "")}</span>
      <div className="cvote">
        {zone(f.t1, t1.name, "a", c1)}
        {showDraw && zone(DRAW, "Draw", "d", cd)}
        {zone(f.t2, t2.name, "b", c2)}
      </div>
      {mine
        ? <div className="crowd-note picked"><Icon.check/> {locked ? "You called " : "Your call: "}{pickName(mine)}</div>
        : !locked && <div className="crowd-note">{showDraw ? "Tap a team or draw to call it" : "Tap a team to call the winner"}</div>}
    </div>
  );
}

/* full match card (home + schedule) */
export function MatchCard({ f, onOpen, onToast }) {
  useSocial();
  useSpoiler();
  const me = getMe();
  const myTeam = !!me && (me.teams.indexOf(f.t1)>=0 || me.teams.indexOf(f.t2)>=0);
  const mine = myTeam; // highlight: your team plays
  const t1 = S.team(f.t1), t2 = S.team(f.t2);
  const o = S.ownersForFixture(f);
  const showScore = f.status === "final" || f.status === "live";
  const s1 = f.score ? f.score[0] : null, s2 = f.score ? f.score[1] : null;

  const isFinal = f.status === "final";
  const winCode = isFinal ? (f.winnerCode && f.winnerCode !== 'DRAW' ? f.winnerCode : (s1 != null && s2 != null ? (s1 > s2 ? f.t1 : s2 > s1 ? f.t2 : null) : null)) : null;
  const isWinner1 = winCode === f.t1;
  const isWinner2 = winCode === f.t2;
  const isLoser1 = isFinal && !isWinner1 && (s1 != null || s2 != null);
  const isLoser2 = isFinal && !isWinner2 && (s1 != null || s2 != null);

  const dim1 = isFinal ? isLoser1 : (showScore && s1 < s2);
  const dim2 = isFinal ? isLoser2 : (showScore && s2 < s1);

  return (
    <article className={"card" + (mine ? " mine":"")} onClick={()=>onOpen && onOpen(f)}>
      <div className="tcbar" style={{ background:`linear-gradient(${t1.color},${t2.color})` }}></div>
      <div className="mc-top">
        <div className="mc-status">
          <StatusPill f={f} />
          {myTeam && <span className="mine-tag"><Icon.star/> Your team</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          {/* StatusPill already conveys live/FT, so show the plain kickoff date (no suffix) */}
          <span className="mc-time">{f.dateTimeLabel}</span>
        </div>
      </div>
      <div className="mc-h">
        <div className={"mc-h-team" + (dim1 ? " dim" : "")}>
          <Flag code={f.t1} w={34} h={25} />
          <span className="nm">{t1.name}</span>
          <div className="mc-h-sub">
            {o.t1.length>0 && <AvStack people={o.t1} size={28} max={3} />}
          </div>
        </div>
        <div className="mc-h-mid" style={{ flexDirection: "column" }}>
          {showScore
            ? (spoilerHidden(f) ? <ScoreCover f={f}/> : (
                  <span className="mc-sc" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span>{s1}</span><i>–</i><span>{s2}</span>
                    <PenScore pen={f.penScore} />
                  </span>
              ))
            : <span className="mc-vs">VS</span>}
        </div>
        <div className={"mc-h-team right" + (dim2 ? " dim" : "")}>
          <Flag code={f.t2} w={34} h={25} />
          <span className="nm">{t2.name}</span>
          <div className="mc-h-sub">
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

/* unified mobile app header — one header for every screen, hidden on desktop
   (the sidebar carries nav there). Two distinct shapes:
     home (`home`)  → the FULL info header: THE SWEEP wordmark + date + the
                      "viewing as" identity selector + sweeps/admin. Sticky,
                      gradually shrinks on scroll (`.home-flow`, --p driven).
     tabs (else)    → a small FIXED bar (`.tab-mini`): trophy + title + the
                      screen's actions (coins/help/spoiler/admin). NO identity
                      chip, NO date, NO scroll-shrink — keeps every non-home tab
                      compact and consistent; the selector lives only on Home. */
export function AppHeader({ home, title, sub, coins, right, onAdmin, go, onSweeps, scrolled, progress, scrollRef, onBack, headRef, replaceSpoiler }) {
  const { isAdmin, pending } = useAdminBadge();
  const sweeps = useSweeps();
  const showAdmin = canModerate(useSweep());
  useSocial();
  const me = getMe();
  const toTop = () => {
    if (home && scrollRef && scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    else go && go("home");
  };
  const viewMe = () => { if (me) window.__sweepViewMe && window.__sweepViewMe(); };
  return (
    <header
      ref={headRef}
      className={"top home-top" + (home ? " home-flow" : " tab-mini")}
      style={home ? { "--p": progress ?? 0 } : undefined}
    >
      <div className="brandrow">
        {onBack ? (
          <button className="brand brand-btn" onClick={onBack} aria-label="Back">
            <div className="mark back"><span className="brand-back-box"><Icon.back/></span></div>
            <div className="brand-tx alt"><b>{title}</b>{sub && <small>{sub}</small>}</div>
          </button>
        ) : (
        <button className="brand brand-btn" onClick={toTop} aria-label={home ? "Scroll to top" : "Today"}>
          <div className="mark"><img src="/trophy.png" alt="The Sweep"/></div>
          <div className={"brand-tx" + (home ? "" : " alt")}>
            <b>{home ? "THE SWEEP" : title}</b>
            {(home || sub) && <small>{home ? "WORLD CUP 2026" : sub}</small>}
          </div>
        </button>
        )}
        {me && (
          <button className={"id-mini" + (!home || (progress ?? 0) > 0.5 ? " on" : "")} onClick={viewMe} aria-label="View your profile">
            <PersonAvatar p={me} cls="av" style={{width:26,height:26,border:0,margin:0,fontSize:11}}/>
            <b>{me.short}</b>
          </button>
        )}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {coins != null && <span className="hdr-coins"><Icon.coin/>{coins.toLocaleString()}</span>}
          {home && <div className="tz"><b>{fmtDate(new Date())}</b></div>}
          {replaceSpoiler != null ? replaceSpoiler : <SpoilerToggle compact/>}
          {right}
          {onSweeps && sweeps.length > 1 && (
            <button onClick={onSweeps} aria-label="My sweeps" style={{width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}>
              <Icon.swap style={{width:15,height:15,stroke:"#9fb6d6"}}/>
            </button>
          )}
          {showAdmin && onAdmin && (
            <button onClick={onAdmin} aria-label={isAdmin && pending>0 ? `Moderation — ${pending} pending` : "Admin"} style={{position:"relative",width:30,height:30,borderRadius:9,background:"rgba(255,255,255,.08)",display:"grid",placeItems:"center"}}>
              <Icon.lock style={{width:15,height:15,stroke:"#9fb6d6"}}/>
              {isAdmin && pending>0 && <span className="hdr-badge">{pending}</span>}
            </button>
          )}
        </div>
      </div>
      {home && <div className="id-full"><IdentityControl dark style={{marginTop:20}}/></div>}
    </header>
  );
}

/* back-compat alias — Home screen renders the header in its `home` variant. */
export function HomeHeader(props) { return <AppHeader home {...props} />; }

/* shrink-on-scroll helper: attach `ref` to a scroll container + `onScroll`.
   Returns a continuous `progress` (0..1, linear in scrollTop over SHRINK_PX) that
   drives the Home header's GRADUAL collapse, plus a latched `scrolled` boolean the
   sibling page/coins headers use for their binary `.shrunk` class. progress is
   computed from the CLAMPED scrollTop so the shrink tracks the finger with no lag
   and iOS rubber-band/overscroll can never push it out of [0,1]. The gradual shrink
   (vs the old instant collapse) is what makes the home-header feedback loop stable;
   the bottom spacer in HomeScreen severs it entirely (constant scrollHeight).

   The sibling headers sit OUTSIDE the flex scroller, so collapsing them grows the
   scroller's clientHeight and the browser re-clamps scrollTop downward — a single
   0.5 threshold would re-cross itself and oscillate ("spaz"). `scrolled` instead
   latches with HYSTERESIS: collapse at/above SHRINK_HI, re-expand only at/below
   SHRINK_LO. The dead-band (≈44px) exceeds the sibling collapse delta (≈26px once
   the identity chip is dropped), so the post-collapse re-clamp can never flip it back. */
export const SHRINK_PX = 220; // D: scroll distance for a full Home-header collapse
export const SHRINK_HI = 0.55; // collapse the sibling header at/above this progress
export const SHRINK_LO = 0.35; // re-expand at/below this; latch in the dead-band between
export function useScrolled(scrollRef, distance = SHRINK_PX) {
  const [progress, setProgress] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Clamp the input into [0, maxScroll]. iOS overscroll can report scrollTop < 0
    // or momentarily > maxScroll; either would over/under-drive the ratio. A bare
    // {scrollTop} mock (no scrollHeight/clientHeight) → max = +Infinity, so progress
    // is just scrollTop/distance.
    const sh = el.scrollHeight, ch = el.clientHeight;
    const max = (Number.isFinite(sh) && Number.isFinite(ch)) ? Math.max(0, sh - ch) : Infinity;
    const y = Math.max(0, Math.min(el.scrollTop, max));
    const p = distance > 0 ? Math.min(1, y / distance) : (y > 0 ? 1 : 0);
    setProgress((prev) => (prev === p ? prev : p));
    setScrolled((prev) => (p >= SHRINK_HI ? true : (p <= SHRINK_LO ? false : prev)));
  };
  return { progress, scrolled, onScroll };
}

/* page header w/ back. On tab screens (no onBack) a trophy logo takes you home.
   `scrolled` collapses it to a compact bar (smaller title, sub hidden).
   Tab headers (go, no back) get `.tab-head` so desktop can drop them — the
   sidebar already carries brand/nav there; mobile keeps the sticky-shrink bar. */
export function PageHeader({ title, sub, onBack, right, tall, scrolled, go, deskHide }) {
  // `.tab-head` → dropped on desktop (the sidebar carries it). Tab screens get it
  // automatically; sidebar destinations that still need a mobile back button
  // (Knockouts) opt in via deskHide.
  const tabHead = deskHide || (go && !onBack);
  return (
    <header className={"top page-top" + (tall ? " tall":"") + (scrolled ? " shrunk":"") + (tabHead ? " tab-head":"")}>
      <div className="phead">
        {onBack
          ? <button className="backbtn" onClick={onBack}><Icon.back/></button>
          : go && <button className="brand brand-btn phead-brand" onClick={()=> go("home")} aria-label="Home">
              <div className="mark"><img src="/trophy.png" alt="The Sweep"/></div>
            </button>}
        <div style={{minWidth:0, flex:1}}>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <SpoilerToggle compact/>
          {right}
        </div>
      </div>
    </header>
  );
}

/* bottom nav */
const TABS = [
  ["home","Today",Icon.home],["schedule","Schedule",Icon.cal],
  ["people","People",Icon.people],["teams","Teams",Icon.ball],["knockouts","Knockouts",Icon.bolt],
  ["coins","Wagers",Icon.coin]
];
export function BottomNav({ tab, go }) {
  useSocial(); // re-render on identity change so the Wagers tab appears/hides
  useOptOut(); // ...and on opt-out, so the tab disappears immediately
  const tabs = TABS.filter(([id]) => id !== "coins" || canWager());
  return (
    <nav className="tabs">
      {tabs.map(([id,label,Ic])=>(
        <button key={id} className={"tab" + (tab===id?" on":"")} onClick={()=>go(id)}>
          <Ic/><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* countdown hook */
export function useCountdown(offsetSec) {
  // tick once a second purely to re-render; the caller recomputes offsetSec from the live
  // clock each render, so the display always tracks the CURRENT next match — when a kickoff
  // passes and the hero rolls to the next one, the clock follows instead of freezing at 0.
  const [, setNow] = useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(t); },[]);
  // a negative offset means kickoff has passed but the match is still the hero (sync grace
  // window) — count UP into negative time instead of freezing at 00:00:00.
  const raw = Math.floor(offsetSec);
  const sign = raw < 0 ? "-" : "";
  const s = Math.abs(raw);
  const pad=n=>String(n).padStart(2,"0");
  const totalH=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60;
  const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600);
  const hms = sign+pad(totalH)+":"+pad(m)+":"+pad(x);
  // when more than a day out, show days so it doesn't read e.g. "96:00:00"
  const display = d>0 ? sign+d+"d "+pad(h)+":"+pad(m)+":"+pad(x) : hms;
  const unit = d>0 ? "DAYS · HRS · MIN · SEC" : "HRS · MIN · SEC";
  return { hms, hm: sign+pad(totalH)+":"+pad(m), display, unit, d, h: totalH, m, x, s: raw };
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
  ["teams","Teams",Icon.ball],["standings","Standings",Icon.bars],["knockouts","Knockouts",Icon.bolt],
  ["coins","Wagers",Icon.coin]
];
export function Sidebar({ current, go, onKnock, onAdmin, onSweeps }) {
  const { isAdmin, pending } = useAdminBadge();
  const sweeps = useSweeps();
  const showAdmin = canModerate(useSweep());
  useSocial(); // re-render on identity change so the Wagers item appears/hides
  useOptOut(); // ...and on opt-out
  const nav = SB_NAV.filter(([id]) => id !== "coins" || canWager());
  return (
    <aside className="sidebar">
      <button className="sb-brand brand-btn" onClick={()=>go("home")} aria-label="Home">
        <div className="mark"><img src="/trophy.png" alt="The Sweep"/></div>
        <div><b>THE SWEEP</b><small>WORLD CUP 2026</small></div>
      </button>
      <div className="sb-sec">Browse</div>
      <nav className="sb-nav">
        {nav.map(([id,label,Ic])=>(
          <button key={id} className={"sb-item"+(current===id?" on":"")} onClick={()=> id==="knockouts" ? onKnock() : go(id)}>
            <Ic/><span>{label}</span>
          </button>
        ))}
      </nav>
      {showAdmin && <>
        <div className="sb-sec">Admin</div>
        <nav className="sb-nav">
          <button className={"sb-item"+(current==="admin"?" on":"")} onClick={onAdmin}>
            <Icon.lock/><span>Moderation</span>{isAdmin && pending>0 && <span className="badge">{pending}</span>}
          </button>
        </nav>
      </>}
      <div className="sb-foot">
        <SpoilerToggle/>
        <IdentityControl dark/>
        {onSweeps && sweeps.length > 1 && <button className="sb-item" onClick={onSweeps} style={{marginTop:8}}><Icon.swap/><span>My sweeps</span></button>}
        <div className="dt" style={{marginTop:12}}><b>{fmtDate(new Date())}</b></div>
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
// Split control: tap the avatar/name → your own profile; tap the ⇄ button →
// change perspective (pick a different person). With nobody picked yet, the
// whole chip opens the picker and the ⇄ button is hidden.
export function IdentityControl({ dark, style }){
  useSocial();
  const me = getMe();
  const pick = () => window.__sweepPickMe && window.__sweepPickMe();
  const view = () => { if (me) { window.__sweepViewMe && window.__sweepViewMe(); } else { pick(); } };
  return (
    <div className={"idchip" + (dark ? " dark" : "")} style={style}>
      <button className="idmain" onClick={view} aria-label={me ? "View your profile" : "Pick who you are"}>
        {me
          ? <PersonAvatar p={me} cls="av" style={{width:42,height:42,border:0,margin:0,fontSize:16}}/>
          : <span className="idq">?</span>}
        <span className="idtxt">
          <small>{me ? "You're viewing as" : "Tap to pick"}</small>
          <b>{me ? me.short : "Who are you?"}</b>
        </span>
      </button>
      {me && (
        <button className="idswap" onClick={pick} aria-label="Change perspective" title="Change perspective">
          <Icon.swap/>
        </button>
      )}
    </div>
  );
}
/* "My sweeps" switcher — lists sweep.sweeps.v1; tap to switch, Leave to drop.
   Leaving the active sweep also clears the server session (postLogout). A failed
   switch (revoked/expired stored token) surfaces an inline error and keeps the
   sheet open, rather than closing on an unhandled rejection. */
export function SweepsSheet({ activeSweepId, onClose, queryClient }){
  const [sweeps, setSweeps] = useState(() => listSweeps());
  const [err, setErr] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const refresh = () => setSweeps(listSweeps());
  const label = (s) => s.name || "Untitled sweep";

  const onSwitch = async (s) => {
    if (s.sweepId === activeSweepId) { onClose(); return; }
    setErr(null);
    try {
      await switchTo(s, queryClient);
      onClose();
    } catch (e) {
      setErr("Couldn't switch sweeps — that invite may have expired. Rejoin from a fresh link, or remove it below.");
    }
  };
  const onLeave = async (s) => {
    removeSweep(s.sweepId);
    if (s.sweepId === activeSweepId) {
      try { await postLogout(); } catch (e) { /* ignore */ }
      // session is gone — drop the now-orphaned sweep data so the Gate falls to
      // the "pick a sweep" landing immediately (refetchOnWindowFocus:false won't).
      queryClient?.invalidateQueries({ queryKey: ["sweep"] });
    }
    refresh();
  };
  const startEdit = (s) => { setEditId(s.sweepId); setEditName(s.name || ""); };
  const saveEdit = (s) => {
    const nm = editName.trim();
    if (nm) renameSweep(s.sweepId, nm);
    setEditId(null); refresh();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"84%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>My sweeps</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          {err && <p role="alert" style={{fontSize:13,color:"var(--accent)",margin:"0 0 12px"}}>{err}</p>}
          {sweeps.length === 0 ? (
            <p style={{fontSize:13,color:"var(--muted2)",textAlign:"center",padding:"24px 0"}}>
              No sweeps on this device yet. Open an invite link to join one.
            </p>
          ) : (
            <div className="plist">
              {sweeps.map(s=>(
                <div className={"prow"+(s.sweepId===activeSweepId?" mepick":"")} key={s.sweepId} style={{padding:"9px 12px"}}>
                  {editId === s.sweepId ? (
                    <>
                      <input className="adminrename" value={editName} onChange={e=>setEditName(e.target.value)}
                        placeholder="Sweep name" aria-label="Sweep name" autoFocus
                        onKeyDown={e=>{ if(e.key==="Enter") saveEdit(s); if(e.key==="Escape") setEditId(null); }} />
                      <button className="allocbtn" onClick={()=>saveEdit(s)}>Save</button>
                    </>
                  ) : (
                    <>
                      <button className="pi" onClick={()=>onSwitch(s)} style={{flex:1,textAlign:"left",border:0,background:"transparent",cursor:"pointer",minWidth:0}}>
                        <b style={{fontSize:16}}>{label(s)}</b>
                        <div className="tms">
                          <span className="t">{s.role === "admin" ? "You can admin this sweep" : "Member"}</span>
                          {s.sweepId===activeSweepId && <span className="t">· current</span>}
                        </div>
                      </button>
                      <button className="rowicon" aria-label={`Rename ${label(s)}`} title="Rename" onClick={()=>startEdit(s)}><Icon.swap/></button>
                      <button className="rowicon danger" aria-label={`Remove ${label(s)}`} title="Remove" onClick={()=>onLeave(s)}><Icon.trash/></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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
          <p style={{fontSize:12.5,color:"var(--muted)",lineHeight:1.45,marginBottom:12}}>Pick yourself so the app can lead with your teams and your support. Stays on this device — no account.</p>
          <SearchInput value={q} onChange={setQ} placeholder="Search by name or team…" autoFocus />
          {people.length===0 && <p style={{fontSize:13,color:"var(--muted2)",textAlign:"center",padding:"18px 0"}}>No one matches “{q}”.</p>}
          <div className="plist">
            {people.map(p=>(
              <div className={"prow"+(me&&me.id===p.id?" mepick":"")} key={p.id} onClick={()=>{ setMe(p.id); toast("You're set as "+p.short); onClose(); }} style={{padding:"9px 12px"}}>
                <PersonAvatar p={p} cls="pav" style={{width:57,height:57,fontSize:22}}/>
                <div className="pi"><b style={{fontSize:16}}>{p.name}</b>
                  <PersonTeams codes={p.teams} /></div>
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
