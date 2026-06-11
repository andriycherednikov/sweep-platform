// web/src/FloatingReactions.jsx
// Ambient, non-interactive "floating reactions". Each notification rises from the
// bottom and fades out around mid-screen, then removes itself. Everyone connected
// (including the actor) sees them.
import { useState, useEffect } from "react";
import { SWEEP as S } from "./data.js";
import { PersonAvatar } from "./components.jsx";
import { onNotification } from "./notifications.js";

const LIFETIME = 4500; // ms — must match the riseFade animation duration

export function FloatingReactions() {
  const [items, setItems] = useState([]);

  useEffect(() => onNotification((n) => {
    // resolve from already-loaded data; skip silently if we can't render it
    const person = S.peopleById[n.personId];
    const team = S.team(n.teamCode);
    const fx = S.fixture(n.fixtureId);
    if (!person || !team || !fx) return;
    const offset = Math.round((Math.random() - 0.5) * 120); // px, spread overlaps
    setItems((xs) => [...xs, { ...n, person, team, fx, offset }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== n.id)), LIFETIME);
  }), []);

  if (items.length === 0) return null;
  return (
    <div className="reactions" aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className="reaction" style={{ "--rx": it.offset + "px" }}>
          <PersonAvatar p={it.person} cls="av" style={{ width: 34, height: 34, border: 0, margin: 0, fontSize: 13 }} />
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
