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
    const person = S.peopleById[n.personId];
    const team = S.team(n.teamCode);
    const fx = S.fixture(n.fixtureId);
    if (!person || !team || !fx) return;
    // random horizontal start, clamped to keep the whole card within the layer
    const w = (wrapRef.current && wrapRef.current.clientWidth) || 360;
    const span = Math.max(0, w - 2 * HALF);
    const offset = Math.round((w - span) / 2 + Math.random() * span - w / 2);
    setItems((xs) => [...xs, { ...n, person, team, fx, offset }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== n.id)), LIFETIME);
  }), []);

  return (
    <div className="reactions" ref={wrapRef} aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className="reaction" style={{ "--rx": it.offset + "px" }}>
          <PersonAvatar p={it.person} cls="av" style={{ width: 40, height: 40, border: 0, margin: 0, fontSize: 15 }} />
          <div className="reaction-txt">
            <small>{it.person.short} {it.action === "switch" ? "switched to" : "is backing"}</small>
            <b><img className="flag" src={S.flag(it.team.code, 40)} alt="" />{it.team.name}</b>
            <span className="reaction-mu">{S.team(it.fx.t1).name} v {S.team(it.fx.t2).name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
