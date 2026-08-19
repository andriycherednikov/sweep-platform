/* ============================================================
   THE SWEEP — self-serve catalog: browse the competition feed and pick one
   to spin up a sweep from. Header-token auth via accountClient; mounted
   OUTSIDE SweepProvider, same standalone pattern as screens-account.jsx.

   The server is the filter: sport chips and search both re-query
   GET /api/catalog rather than filtering the already-loaded rows.
   ============================================================ */
import { useState, useEffect, useMemo } from "react";
import { Console, LinkField, goTo } from "./screens-account.jsx";
import { getCatalog, createSweep } from "./lib/accountClient.js";

// Provision error code → what the owner should do about it.
const PROVISION_ERRORS = {
  subscription_required: "Your trial has ended — subscribe to start new sweeps.",
  unknown_competition: "That competition can't be set up right now.",
};

/* Provision overlay: name + wagering toggle → seconds-long synchronous feed
   sync server-side, so the pending state is load-bearing, not decoration. */
function ProvisionSheet({ league, season, onClose }) {
  const [name, setName] = useState(`${league.name} ${season}`);
  const [wagering, setWagering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null); // { code, cap }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      setDone(await createSweep({
        name, provider: league.provider, leagueId: league.leagueId, season, wageringEnabled: wagering,
      }));
    } catch (e2) {
      setErr({ code: e2.code, cap: e2.body?.cap });
    } finally { setBusy(false); }
  }

  return (
    <div className="ac-scrim" onClick={busy ? undefined : onClose}>
      <div className="ac-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="lp-eyebrow">{done ? "Ready" : "New sweep"}</p>
        <h2 className="ac-sheet-h">{done ? "Your sweep is live" : `${league.name} · ${season}`}</h2>
        {done ? (
          <>
            <p className="ac-b">Share the member link with your group; keep the admin link to yourself.</p>
            <LinkField label="Member link" value={done.memberLink} />
            <LinkField label="Admin link" value={done.adminLink} />
            <button className="lp-btn ac-btn" onClick={() => goTo("/account")}>Done</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="ac-field">
              <span>What the group will call it</span>
              <input type="text" required placeholder="Sweep name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ac-check">
              <input type="checkbox" checked={wagering} onChange={(e) => setWagering(e.target.checked)} />
              Enable Wagers (play-money betting)
            </label>
            <button className="lp-btn ac-btn" type="submit" disabled={busy}>Start sweep</button>
            {busy && <p className="ac-b">Setting up — fetching teams and games…</p>}
            {err && (
              <p className="ac-warn">
                {err.code === "sweep_cap"
                  ? `You've reached your sweep limit${err.cap ? ` (${err.cap})` : ""}. Archive one to make room.`
                  : PROVISION_ERRORS[err.code] || "Something went wrong — try again."}
                {err.code === "subscription_required" && <> <a className="ac-link-a" href="/account">Go to billing</a></>}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function CatalogRow({ row, onPick }) {
  const [season, setSeason] = useState(row.seasons?.[0]?.season);

  return (
    <div className="ac-row">
      {row.logo && <img className="ac-row-logo" src={row.logo} alt="" width={30} height={30} />}
      <div className="ac-row-id">
        <b>{row.name}</b>
        {row.country?.name && <span>{row.country.name}</span>}
      </div>
      <select className="ac-select" value={season} onChange={(e) => setSeason(e.target.value)}>
        {(row.seasons || []).map((s) => <option key={s.season} value={s.season}>{s.season}</option>)}
      </select>
      <button className="ac-ghost is-go" onClick={() => onPick(row, season)}>Set up sweep</button>
    </div>
  );
}

export function CatalogScreen({ onBack, onPick = () => {} }) {
  const [sport, setSport] = useState(null); // null = "All"
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [picked, setPicked] = useState(null); // { row, season } → provision sheet open

  const pick = (row, season) => { onPick(row, season); setPicked({ row, season }); };

  // ponytail: below the 2-char search floor we just don't adopt the typed
  // value — debouncedQ stays put, so the fetch effect's deps don't change
  // and no request fires. Backspacing 2→1 chars leaves a stale query in
  // flight; upgrade to a real cancel-token if that ever bites.
  useEffect(() => {
    if (q.length === 1) return;
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    const params = {};
    if (sport) params.sport = sport;
    if (debouncedQ.length >= 2) params.q = debouncedQ;
    getCatalog(params)
      .then((data) => { if (alive) setRows(data); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sport, debouncedQ, reloadKey]);

  const sports = useMemo(() => Array.from(new Set(rows.map((r) => r.sport))), [rows]);

  return (
    <Console
      nav={
        <>
          <button className="ac-nav-i" onClick={onBack}>Sweeps</button>
          <button className="ac-nav-i is-here">New sweep</button>
        </>
      }
    >
      <p className="lp-eyebrow">New sweep</p>
      <h1 className="ac-h1">Pick a competition</h1>
      <p className="ac-sub">The sweep binds to one season of one competition and pulls its own fixtures.</p>

      <div className="ac-tools">
        <div className="ac-chips">
          <button className={"ac-chip" + (!sport ? " is-on" : "")} onClick={() => setSport(null)}>All</button>
          {sports.map((sp) => (
            <button key={sp} className={"ac-chip" + (sport === sp ? " is-on" : "")} onClick={() => setSport(sp)}>
              {cap(sp)}
            </button>
          ))}
        </div>
        <input
          className="ac-search"
          type="text"
          placeholder="Search competitions"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading && <p className="ac-b">Loading…</p>}
      {error && (
        <div className="ac-card">
          <p className="ac-warn">Something went wrong. Try again.</p>
          <button className="ac-ghost" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="ac-card ac-empty"><h3 className="ac-card-h">No competitions match.</h3></div>
      )}
      {!loading && !error && (
        <div className="ac-rows">
          {rows.map((row) => (
            <CatalogRow key={`${row.provider}-${row.sport}-${row.leagueId}`} row={row} onPick={pick} />
          ))}
        </div>
      )}
      {picked && <ProvisionSheet league={picked.row} season={picked.season} onClose={() => setPicked(null)} />}
    </Console>
  );
}
