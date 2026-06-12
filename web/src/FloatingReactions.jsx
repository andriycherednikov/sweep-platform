// web/src/FloatingReactions.jsx
// Ambient, non-interactive "floating reactions". Each notification rises from the
// bottom and fades out around mid-screen, then removes itself. Everyone connected
// (including the actor) sees them.
import { useState, useEffect, useRef } from "react";
import { SWEEP as S } from "./data.js";
import { PersonAvatar } from "./components.jsx";
import { onNotification } from "./notifications.js";

const LIFETIME = 4500; // ms — must match the riseFade animation duration
const HALF = 150; // ~half a card width + margin, to keep cards on-screen

export function FloatingReactions() {
  const [items, setItems] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => onNotification((n) => {
    // resolve from already-loaded data; skip silently if we can't render it
    const fx = S.fixture(n.fixtureId);
    if (!fx) return;
    let resolved;
    if (n.kind === "match") {
      resolved = { ...n, fx };
    } else {
      const person = S.peopleById[n.personId];
      const team = S.team(n.teamCode);
      if (!person || !team) return;
      resolved = { ...n, person, team, fx };
    }
    // random horizontal start, clamped to keep the whole card within the layer
    const w = (wrapRef.current && wrapRef.current.clientWidth) || 360;
    const span = Math.max(0, w - 2 * HALF);
    resolved.offset = Math.round((w - span) / 2 + Math.random() * span - w / 2);
    setItems((xs) => [...xs, resolved]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== n.id)), LIFETIME);
  }), []);

  return (
    <div className="reactions" ref={wrapRef} aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className="reaction-row">
          <div className="reaction" style={{ "--rx": it.offset + "px" }}>
            {it.kind === "match" ? <MatchReaction it={it} /> : <BackReaction it={it} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function BackReaction({ it }) {
  return (
    <>
      <PersonAvatar p={it.person} cls="av" style={{ width: 40, height: 40, border: 0, margin: 0, fontSize: 15 }} />
      <div className="reaction-txt">
        <small>{it.person.short} {it.action === "switch" ? "switched to" : "is backing"}</small>
        <b><img className="flag" src={S.flag(it.team.code, 40)} alt="" />{it.team.name}</b>
        <span className="reaction-mu">{S.team(it.fx.t1).name} v {S.team(it.fx.t2).name}</span>
      </div>
    </>
  );
}

function MatchReaction({ it }) {
  const a = S.team(it.fx.t1), b = S.team(it.fx.t2);
  const score = it.score ? `${it.score[0]}–${it.score[1]}` : null;
  if (it.event === "goal") {
    const scorer = S.team(it.teamCode);
    const tag = /penalty/i.test(it.detail || "") ? " (P)" : /own goal/i.test(it.detail || "") ? " (OG)" : "";
    return (
      <>
        <span className="reaction-badge">⚽</span>
        <div className="reaction-txt">
          <small>Goal!{it.minute != null ? ` · ${it.minute}'` : ""}</small>
          <b><img className="flag" src={S.flag(scorer.code, 40)} alt="" />{it.player || scorer.name}{tag}</b>
          <span className="reaction-mu">{a.name} {score} {b.name}</span>
        </div>
      </>
    );
  }
  if (it.event === "card") {
    const team = S.team(it.teamCode);
    const red = it.card === "red";
    return (
      <>
        <span className="reaction-badge">{red ? "🟥" : "🟨"}</span>
        <div className="reaction-txt">
          <small>{red ? "Red" : "Yellow"} card{it.minute != null ? ` · ${it.minute}'` : ""}</small>
          <b><img className="flag" src={S.flag(team.code, 40)} alt="" />{it.player || team.name}</b>
          <span className="reaction-mu">{a.name} v {b.name}</span>
        </div>
      </>
    );
  }
  if (it.event === "start") {
    return (
      <>
        <span className="reaction-badge">🟢</span>
        <div className="reaction-txt">
          <small>Kick-off</small>
          <b>{a.name} v {b.name}</b>
          <span className="reaction-mu">Now live</span>
        </div>
      </>
    );
  }
  return ( // full time
    <>
      <span className="reaction-badge">🏁</span>
      <div className="reaction-txt">
        <small>Full time</small>
        <b>{a.name} {score} {b.name}</b>
        <span className="reaction-mu">Result is in</span>
      </div>
    </>
  );
}
