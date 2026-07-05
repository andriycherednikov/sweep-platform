/* ============================================================
   THE SWEEP — self-serve catalog: browse the competition feed and pick one
   to spin up a sweep from. Header-token auth via accountClient; mounted
   OUTSIDE SweepProvider, same standalone pattern as screens-account.jsx.

   The server is the filter: sport chips and search both re-query
   GET /api/catalog rather than filtering the already-loaded rows.
   ============================================================ */
import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "./components.jsx";
import { LinkField } from "./screens-super.jsx";
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
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-head"><h3>{done ? "Your sweep is live" : "New sweep"}</h3></div>
        <div className="sheet-body">
          {done ? (
            <>
              <p className="sweep-card-sub">Share the member link with your group; keep the admin link to yourself.</p>
              <LinkField label="Member link" value={done.memberLink} />
              <LinkField label="Admin link" value={done.adminLink} />
              <button className="cta" style={{ marginTop: 12 }} onClick={() => window.location.assign("/account")}>Done</button>
            </>
          ) : (
            <form onSubmit={submit}>
              <p className="sweep-card-sub">{league.name} · {season}</p>
              <input
                type="text" required placeholder="Sweep name" value={name}
                onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginBottom: 10 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" checked={wagering} onChange={(e) => setWagering(e.target.checked)} />
                Enable Wagers (play-money betting)
              </label>
              <button className="cta" type="submit" disabled={busy}>Start sweep</button>
              {busy && <p className="sweep-card-sub" style={{ marginTop: 8 }}>Setting up — fetching teams and games…</p>}
              {err && (
                <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8 }}>
                  {err.code === "sweep_cap"
                    ? `You've reached your sweep limit${err.cap ? ` (${err.cap})` : ""}. Archive one to make room.`
                    : PROVISION_ERRORS[err.code] || "Something went wrong — try again."}
                  {err.code === "subscription_required" && <> <a href="/account">Go to billing</a></>}
                </p>
              )}
            </form>
          )}
        </div>
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
    <div className="block" style={{ padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
      {row.logo && <img src={row.logo} alt="" width={28} height={28} style={{ borderRadius: 6, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 16 }}>{row.name}</b>
        {row.country?.name && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{row.country.name}</div>}
      </div>
      <select value={season} onChange={(e) => setSeason(e.target.value)}>
        {(row.seasons || []).map((s) => <option key={s.season} value={s.season}>{s.season}</option>)}
      </select>
      <button className="allocbtn primary" onClick={() => onPick(row, season)}>Set up sweep</button>
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="New sweep" sub="Pick a competition" onBack={onBack} />
      <div className="filterbar">
        <button className={"fchip" + (!sport ? " on" : "")} onClick={() => setSport(null)}>All</button>
        {sports.map((sp) => (
          <button key={sp} className={"fchip" + (sport === sp ? " on accent" : "")} onClick={() => setSport(sp)}>
            {cap(sp)}
          </button>
        ))}
      </div>
      <div className="scroll pad screen-anim" style={{ paddingTop: 12 }}>
        <div className="wrap super-wrap">
          <input
            type="text"
            placeholder="Search competitions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 12, width: "100%" }}
          />
          {loading && <p className="sweep-card-sub">Loading…</p>}
          {error && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 12.5, color: "var(--accent)" }}>Something went wrong. Try again.</p>
              <button className="allocbtn" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="empty"><div className="ic">🔍</div><h3>No competitions match.</h3></div>
          )}
          {!loading && !error && rows.map((row) => (
            <CatalogRow key={`${row.provider}-${row.sport}-${row.leagueId}`} row={row} onPick={pick} />
          ))}
        </div>
      </div>
      {picked && <ProvisionSheet league={picked.row} season={picked.season} onClose={() => setPicked(null)} />}
    </div>
  );
}
