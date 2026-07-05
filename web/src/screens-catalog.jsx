/* ============================================================
   THE SWEEP — self-serve catalog: browse the competition feed and pick one
   to spin up a sweep from. Header-token auth via accountClient; mounted
   OUTSIDE SweepProvider, same standalone pattern as screens-account.jsx.

   The server is the filter: sport chips and search both re-query
   GET /api/catalog rather than filtering the already-loaded rows.
   ============================================================ */
import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "./components.jsx";
import { getCatalog } from "./lib/accountClient.js";

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
            <CatalogRow key={`${row.provider}-${row.sport}-${row.leagueId}`} row={row} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  );
}
