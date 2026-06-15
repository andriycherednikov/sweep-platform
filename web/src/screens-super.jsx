/* ============================================================
   THE SWEEP — super-admin (platform owner) console
   Token-gated: list / create / rotate / archive / rename sweeps.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { Icon, PageHeader } from "./components.jsx";
import {
  postSuperSession, fetchSuperSweeps, createSweep, rotateSweepToken,
  archiveSweep, unarchiveSweep, patchSweep,
} from "./api/client.js";

/* readonly, tap-to-select link field — "copyable" without a clipboard dependency */
function LinkField({ label, value }) {
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

/* one sweep row: rename, rotate member/admin (with tail note), archive/restore */
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

      {/* The default sweep is host-bound (no capability tokens); only its name is editable. */}
      {s.kind !== "default" && (
        <>
          {s.memberLink && <LinkField label="Member link" value={s.memberLink} />}
          {s.adminLink && <LinkField label="Admin link" value={s.adminLink} />}
          <div className="super-actions">
            <button className="allocbtn" disabled={busy} aria-label={`Rotate member ${s.id}`}
              onClick={() => run(() => rotateSweepToken(s.id, "member"), "Member link rotated")}>Rotate member link</button>
            <button className="allocbtn" disabled={busy} aria-label={`Rotate admin ${s.id}`}
              onClick={() => run(() => rotateSweepToken(s.id, "admin"), "Admin link rotated")}>Rotate admin link</button>
            {archived
              ? <button className="allocbtn" disabled={busy} aria-label={`Restore ${s.id}`}
                  onClick={() => run(() => unarchiveSweep(s.id), "Restored")}>Restore</button>
              : <button className="allocbtn danger" disabled={busy} aria-label={`Archive ${s.id}`}
                  onClick={() => run(() => archiveSweep(s.id), "Archived")}>Archive</button>}
          </div>
        </>
      )}
    </div>
  );
}

function SuperList({ onToast }) {
  const [sweeps, setSweeps] = useState([]);
  const [newName, setNewName] = useState("");
  const [created, setCreated] = useState(null); // {memberLink, adminLink, name}
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setSweeps(await fetchSuperSweeps()); }
    catch { onToast("Couldn't load sweeps"); }
  }, [onToast]);

  useEffect(() => { reload(); }, [reload]);

  async function create() {
    const nm = newName.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      const res = await createSweep(nm);
      setCreated(res);
      setNewName("");
      await reload();
      onToast("Sweep created");
    } catch { onToast("Create failed — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="scroll pad screen-anim" style={{ paddingTop: 12 }}>
      <div className="wrap super-wrap">
        {/* create */}
        <div className="block" style={{ padding: "12px 14px", marginBottom: 14 }}>
          <div className="field">
            <label>New sweep</label>
            <div className="super-row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New sweep name" style={{ flex: 1 }} />
              <button className="allocbtn primary" disabled={busy || !newName.trim()} onClick={create}>Create sweep</button>
            </div>
          </div>
          {created && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--live)" }}>“{created.name}” created — share these links:</div>
              <LinkField label="Member link" value={created.memberLink} />
              <LinkField label="Admin link" value={created.adminLink} />
            </div>
          )}
        </div>

        <div className="note-line" style={{ marginBottom: 12 }}>
          <Icon.shield style={{ stroke: "var(--live)" }} />
          <span>Rotating a link takes effect immediately for new joins; the old link keeps working for up to 8h while existing sessions expire.</span>
        </div>

        {sweeps.map((s) => <SweepRow key={s.id} s={s} onToast={onToast} reload={reload} />)}
        {sweeps.length === 0 && <div className="empty"><div className="ic">🗂️</div><h3>No sweeps yet</h3><p>Create the first one above.</p></div>}
      </div>
    </div>
  );
}

export function SuperConsole({ onBack, onToast, autoToken }) {
  const [unlocked, setUnlocked] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const submit = useCallback(async (t) => {
    const tk = (t ?? "").trim();
    if (!tk) return;
    setBusy(true); setError(false);
    try { await postSuperSession(tk); setUnlocked(true); }
    catch { setError(true); }
    finally { setBusy(false); }
  }, []);

  // /super/<token> deep link: auto-submit once on mount
  useEffect(() => { if (autoToken) submit(autoToken); }, [autoToken, submit]);

  if (!unlocked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PageHeader title="Super admin" sub="Platform owner only" onBack={onBack} />
        <div className="scroll pad screen-anim" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 28 }}>
          <div className="lockic"><Icon.lock /></div>
          <h3 style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, textTransform: "uppercase", color: "var(--navy)" }}>Enter super token</h3>
          <div className="field" style={{ width: "100%", maxWidth: 360, marginTop: 14 }}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(token); }}
              placeholder="Super token"
            />
          </div>
          {error && <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8 }}>That token didn’t work.</p>}
          <button className="cta" disabled={busy || !token.trim()} onClick={() => submit(token)} style={{ marginTop: 14, maxWidth: 360, width: "100%" }}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="Super admin" sub="Sweeps" onBack={onBack} right={<div className="iconbtn"><Icon.shield /></div>} />
      <SuperList onToast={onToast} />
    </div>
  );
}
