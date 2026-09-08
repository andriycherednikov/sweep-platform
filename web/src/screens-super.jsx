/* ============================================================
   THE SWEEP — super-admin (platform owner) console
   Account-gated: list / archive / rename sweeps.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { Icon, PageHeader } from "./components.jsx";
import {
  fetchSuperSweeps, archiveSweep, unarchiveSweep, patchSweep,
} from "./api/client.js";

/* readonly, tap-to-select link field — "copyable" without a clipboard dependency */
export function LinkField({ label, value }) {
  return (
    <label className="field" style={{ marginTop: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted2)" }}>{label}</span>
      <input
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.target.select()}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />
    </label>
  );
}

/* one sweep row: rename, archive/restore */
function SweepRow({ s, onToast, reload }) {
  const [name, setName] = useState(s.name || "");
  const [busy, setBusy] = useState(false);
  const archived = !!s.archivedAt;

  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); onToast(ok); await reload(); }
    catch { onToast("Action failed — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="block" style={{ padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 16 }}>{s.name}</b>
        <span style={{ fontSize: 11, color: "var(--muted2)", fontWeight: 700 }}>{s.kind}</span>
        {archived && <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800 }}>· Archived</span>}
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted2)" }}>Name</span>
        <div className="super-row">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <button className="allocbtn" disabled={busy} aria-label={`Save name ${s.id}`}
            onClick={() => run(() => patchSweep(s.id, { name: name.trim() }), "Renamed")}>Save</button>
        </div>
      </div>

      {/* The default sweep is host-bound (no capability tokens); only its name is editable.
          No link is ever shown here, and no rotate button either: a live member token in
          the operator console is the ability to open a customer's sweep as one of its
          members, which the API deliberately stopped handing out (fetchSuperSweeps()
          carries no link fields, and the rotate route is gone server-side). */}
      {s.kind !== "default" && (
        <div className="super-actions">
          {archived
            ? <button className="allocbtn" disabled={busy} aria-label={`Restore ${s.id}`}
                onClick={() => run(() => unarchiveSweep(s.id), "Restored")}>Restore</button>
            : <button className="allocbtn danger" disabled={busy} aria-label={`Archive ${s.id}`}
                onClick={() => run(() => archiveSweep(s.id), "Archived")}>Archive</button>}
        </div>
      )}
    </div>
  );
}

function SweepList({ sweeps, onToast, reload }) {
  return (
    <div className="scroll pad screen-anim" style={{ paddingTop: 12 }}>
      <div className="wrap super-wrap">
        {sweeps.map((s) => <SweepRow key={s.id} s={s} onToast={onToast} reload={reload} />)}
        {sweeps.length === 0 && <div className="empty"><div className="ic">🗂️</div><h3>No sweeps yet</h3><p>Sweeps appear here once an owner sets one up.</p></div>}
      </div>
    </div>
  );
}

/** Not signed in (401) vs signed in but not an operator (403) — told apart only by the
 *  HTTP status the server actually returned, never by a role field the client reads
 *  off its own account. The server is the one authority on who is an operator. */
function LockedOut({ status, onBack }) {
  const forbidden = status === "forbidden";
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="Super admin" sub="Platform owner only" onBack={onBack} />
      <div className="scroll pad screen-anim" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 28, textAlign: "center" }}>
        <div className="lockic"><Icon.lock /></div>
        <h3 style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, textTransform: "uppercase", color: "var(--navy)" }}>
          {forbidden ? "Not an operator" : "Sign in required"}
        </h3>
        <p style={{ fontSize: 12.5, color: "var(--muted2)", marginTop: 8, maxWidth: 320 }}>
          {forbidden
            ? "This account isn't allowed to run the platform console."
            : "The super console runs on your account, not a link — sign in to continue."}
        </p>
        {!forbidden && (
          <a className="cta" href="/account" style={{ marginTop: 14, maxWidth: 360, width: "100%" }}>Sign in</a>
        )}
      </div>
    </div>
  );
}

export function SuperConsole({ onBack, onToast }) {
  const [status, setStatus] = useState("checking"); // checking | signedOut | forbidden | ok
  const [sweeps, setSweeps] = useState([]);

  const reload = useCallback(async () => {
    try {
      const rows = await fetchSuperSweeps();
      setSweeps(rows);
      setStatus("ok");
    } catch (err) {
      setStatus(err?.status === 403 ? "forbidden" : "signedOut");
    }
  }, []);

  // No token to submit any more — the account session already carries whatever role
  // it has, so the console just tries the listing and reads what the server says.
  useEffect(() => { reload(); }, [reload]);

  if (status === "checking") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PageHeader title="Super admin" sub="Platform owner only" onBack={onBack} />
        <div className="sweep-gate" />
      </div>
    );
  }

  if (status !== "ok") return <LockedOut status={status} onBack={onBack} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="Super admin" sub="Sweeps" onBack={onBack} right={<div className="iconbtn"><Icon.shield /></div>} />
      <SweepList sweeps={sweeps} onToast={onToast} reload={reload} />
    </div>
  );
}
