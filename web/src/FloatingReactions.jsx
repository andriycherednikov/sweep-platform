// web/src/FloatingReactions.jsx
// Ambient, non-interactive "floating reactions". Each notification rises from the
// bottom and fades out around mid-screen, then removes itself. Everyone connected
// (including the actor) sees them.
import { useState, useEffect, useRef } from "react";
import { SWEEP as S } from "./data.js";
import { PersonAvatar, Flag } from "./components.jsx";
import { onNotification } from "./notifications.js";
import { DRAW } from "./social.js";
import { isSpoiler, isRevealed } from "./spoiler.js";
import { MARKET_LABELS } from "./lib/betLabels.js";

const LIFETIME = 4500; // ms — must match the riseFade animation duration
const HALF = 150; // ~half a card width + margin, to keep cards on-screen

export function FloatingReactions() {
  const [items, setItems] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => onNotification((n) => {
    // spoiler mode: suppress match-event popups (goal/card/kick-off/full-time) for a
    // still-hidden match — they would announce the score/result. Social reactions pass.
    if (n.kind === "match" && isSpoiler() && !isRevealed(n.fixtureId)) return;
    // resolve from already-loaded data; skip silently if we can't render it
    let resolved;
    if (n.kind === "multi") {
      // a parlay spans several fixtures — there's no single fixture to resolve
      const person = S.peopleById[n.personId];
      if (!person) return;
      resolved = { ...n, person };
    } else {
      const fx = S.fixture(n.fixtureId);
      if (!fx) return;
      if (n.kind === "match") {
        resolved = { ...n, fx };
      } else if (n.kind === "bet") {
        const person = S.peopleById[n.personId];
        if (!person) return;
        resolved = { ...n, person, fx };
      } else {
        const person = S.peopleById[n.personId];
        if (!person) return;
        const isDraw = n.teamCode === DRAW;
        const team = isDraw ? null : S.team(n.teamCode);
        if (!isDraw && !team) return;
        resolved = { ...n, person, team, isDraw, fx };
      }
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
            {it.kind === "match" ? <MatchReaction it={it} /> : it.kind === "bet" ? <BetReaction it={it} /> : it.kind === "multi" ? <MultiReaction it={it} /> : <BackReaction it={it} />}
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
        <b>
          {it.isDraw
            ? <><span aria-hidden="true" style={{ marginRight: 6 }}>🤝</span>Draw</>
            : <><Flag code={it.team.code} w={22} h={16} />{it.team.name}</>}
        </b>
        <MatchupLine fx={it.fx} />
      </div>
    </>
  );
}

// describe a bet selection for the reaction: market name, readable label, optional team flag
function describeBet(market, selection, fx) {
  const marketName = MARKET_LABELS[market] || "Bet";
  if (market === "1x2" || market === "fh1x2" || market === "toq" || market === "ml" || market === "hcap") {
    if (selection === "HOME") return { marketName, label: S.team(fx.t1)?.name || "Home", flagCode: fx.t1 };
    if (selection === "AWAY") return { marketName, label: S.team(fx.t2)?.name || "Away", flagCode: fx.t2 };
    return { marketName, label: "Draw", flagCode: null };
  }
  if (market === "ou25" || market === "cards" || market === "ou" || market === "fhou") {
    const line = fx.markets?.[market]?.line ?? (market === "ou25" ? 2.5 : "");
    return { marketName, label: `${selection === "OVER" ? "Over" : "Under"} ${line}`.trim(), flagCode: null };
  }
  if (market === "cs") return { marketName, label: String(selection).replace(":", "-"), flagCode: null };
  return { marketName, label: selection, flagCode: null };
}

function BetReaction({ it }) {
  const { marketName, label, flagCode } = describeBet(it.market, it.selection, it.fx);
  return (
    <>
      <PersonAvatar p={it.person} cls="av" style={{ width: 40, height: 40, border: 0, margin: 0, fontSize: 15 }} />
      <div className="reaction-txt">
        <small>{it.person.short} backed</small>
        <b>{flagCode ? <><Flag code={flagCode} w={22} h={16} />{label}</> : label}</b>
        <span className="reaction-mkt">{marketName}</span>
        <MatchupLine fx={it.fx} />
      </div>
    </>
  );
}

// a multi (parlay) placement — no single fixture, so just the actor + leg count
function MultiReaction({ it }) {
  return (
    <>
      <PersonAvatar p={it.person} cls="av" style={{ width: 40, height: 40, border: 0, margin: 0, fontSize: 15 }} />
      <div className="reaction-txt">
        <small>{it.person.short} placed a</small>
        <b><span className="reaction-multi-ico" aria-hidden="true">🎟️</span>Multi · {it.legCount} legs</b>
        <span className="reaction-mu">Good luck!</span>
      </div>
    </>
  );
}

// bottom matchup line: small flag · team v team · small flag
function MatchupLine({ fx, mid = "v" }) {
  const a = S.team(fx.t1), b = S.team(fx.t2);
  return (
    <span className="reaction-mu">
      <Flag code={a.code} w={15} h={11} cls="muflag" />{a.name} {mid} {b.name}<Flag code={b.code} w={15} h={11} cls="muflag" />
    </span>
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
          <b>{scorer && <Flag code={scorer.code} w={22} h={16} />}{it.player || scorer?.name}{tag}</b>
          <MatchupLine fx={it.fx} mid={score || "v"} />
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
          <b>{team && <Flag code={team.code} w={22} h={16} />}{it.player || team?.name}</b>
          <MatchupLine fx={it.fx} />
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
          <b><Flag code={a.code} w={22} h={16} />{a.name} v {b.name}<Flag code={b.code} w={22} h={16} /></b>
          <span className="reaction-mu">Now live</span>
        </div>
      </>
    );
  }
  return ( // full time
    <>
      <span className="reaction-badge">🏁</span>
      <div className="reaction-txt">
        <small>{S.vocab.finalLabel}</small>
        <b><Flag code={a.code} w={22} h={16} />{a.name} {score} {b.name}<Flag code={b.code} w={22} h={16} /></b>
        <span className="reaction-mu">Result is in</span>
      </div>
    </>
  );
}
