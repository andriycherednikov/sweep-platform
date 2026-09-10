/* ============================================================
   THE SWEEP — one sweep you run, on its own page in the account console.

   The console owns the sweep's SETTINGS: what it is called, the link that lets people
   in, and whether it runs wagering. The roster, the draw and the bet queue stay at
   /s/:id/admin and are linked from here rather than moved, because they are not
   movable as they stand: PeopleAdmin, SweepDraw and AdminQueue read the `S` global that
   only SweepProvider's fetchAll() fills, and every /api/admin/* route wants the signed
   sweep cookie plus the x-sweep-id header that api/client.js's setActiveSweep sets.
   This console mounts OUTSIDE SweepProvider and authenticates with x-account-token
   instead, so bringing them across means an openSweepSession + setActiveSweep
   handshake, a provider mount and a query client — for screens that already work one
   click away. The links carry the counts that make them worth clicking; that is the
   part the console really was missing.

   Its own file rather than screens-account.jsx, which is already 600 lines of a
   different job (the front door, the list, billing, account settings) and is about to
   grow the dashboard as well.
   ============================================================ */
import { useState, useEffect } from "react";
import { Console, LinkField, CompetitionLine, fmtDay, goTo } from "./screens-account.jsx";
import { getAccountSweeps, getAccountStats, patchSweep, archiveSweep, rotateSweep } from "./lib/accountClient.js";
import { SweepStory } from "./screens-dashboard.jsx";

/** A refused save has exactly two meanings and they need different answers: a lapsed
 *  owner is not having a bad day, they are behind the read-only gate and retrying will
 *  never work. Everything else is worth another go. */
function SaveError({ code }) {
  if (!code) return null;
  if (code === "sweep_readonly")
    return (
      <p className="ac-warn">
        Your trial has ended, so this sweep is read-only — nothing about it can change
        until you <a className="ac-inline" href="/account">subscribe</a>.
      </p>
    );
  return <p className="ac-warn">Couldn't save that. Try again.</p>;
}

/** What the sweep is called and what it follows. The name is the heading AND the field
 *  that changes it — an input the whole way down rather than a click-to-edit dance, so
 *  the keyboard and screen readers get a real form control and there is no second state
 *  to be stranded in. */
function Identity({ s }) {
  const [name, setName] = useState(s.name);
  const [saved, setSaved] = useState(s.name);
  const [err, setErr] = useState(null);
  const since = fmtDay(s.createdAt);

  // ponytail: the rail beside this page keeps showing the old name until the next
  // navigation — it read the sweep list once when the console mounted, and has no way
  // to hear about this. A shared store (or the query client the console does not have)
  // is the upgrade; renames are rare, and the heading right here tells the truth.
  async function save() {
    const next = name.trim();
    if (!next || next === saved) { setName(saved); return; }
    setErr(null);
    try { await patchSweep(s.id, { name: next }); setSaved(next); }
    // Optimistic, then honest — the same as the wagering toggle below. A refused rename
    // used to leave the typed name in the heading, which is the one place on the app
    // that claims to say what this sweep is called: a lapsed owner would go on calling
    // it that while every other screen, and everyone else's, disagreed.
    catch (e) { setName(saved); setErr(e.code || "failed"); }
  }

  return (
    <>
      <p className="lp-eyebrow">Your sweep</p>
      <input
        className="ac-h1 ac-rename"
        aria-label="Sweep name"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      <CompetitionLine s={s} />
      <p className="ac-sub">
        {since ? `Running since ${since} · ` : ""}{s.members.total} in the sweep
        {" · "}<a className="ac-inline" href={`/s/${s.id}`}>Open the sweep</a>
      </p>
      <SaveError code={err} />
    </>
  );
}

/** The member link and the one thing you can do about it having leaked. Lifted out of
 *  the list card: the warning copy is the same words because a link that locks the
 *  whole group out deserves the same sentence wherever it is offered. */
function Share({ s }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotated, setRotated] = useState(null);
  const [err, setErr] = useState(false);

  // The member link is the sweep's only credential, so a link pasted into the wrong
  // chat can only be taken back by replacing it — which locks out everyone still using
  // the old one. Hence the two-step confirm, and the new link shown straight after so
  // the owner can send it on. Never gated on billing: a lapsed owner needs this more
  // than anyone (api rotate is requireLive:false).
  async function rotate() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true); setErr(false);
    try {
      const { memberLink } = await rotateSweep(s.id);
      setRotated(memberLink);
      setConfirm(false);
    } catch { setErr(true); setConfirm(false); }
    finally { setBusy(false); }
  }

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Getting people in</h2>
      <LinkField label="Member link — send this to the group" value={rotated || s.memberLink} />
      {rotated && <p className="ac-b">New link ready — send it to the group. The old link stopped working.</p>}
      {confirm && (
        <p className="ac-warn">
          This replaces the link for everyone: anyone using the old one is locked out until you send them this new one.
        </p>
      )}
      <button className="ac-ghost is-danger" style={{ marginTop: 10 }} disabled={busy} onClick={rotate}>
        {confirm ? "Yes, replace the link" : "Replace link"}
      </button>
      {err && <p className="ac-warn">Couldn't replace the link — try again.</p>}
    </section>
  );
}

/** Wagering was a decision you made once, in the provision sheet, and could never
 *  revisit: the only route that flips it (POST /api/admin/wagering) needs a sweep
 *  cookie, which this console does not have. It goes through the same PATCH as the
 *  name instead. */
function Settings({ s }) {
  const [on, setOn] = useState(!!s.wageringEnabled);
  const [err, setErr] = useState(null);

  async function toggle(e) {
    const next = e.target.checked;
    setOn(next);
    setErr(null);
    // Optimistic, then honest: a refused toggle springs back rather than sitting there
    // claiming a state the sweep is not in.
    try { await patchSweep(s.id, { wageringEnabled: next }); }
    catch (e2) { setOn(!next); setErr(e2.code || "failed"); }
  }

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Settings</h2>
      <label className="ac-toggle">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span>Wagering</span>
      </label>
      <p className="ac-b">
        Lets the group put their coins on results — moneylines, totals and handicaps on
        the fixtures this competition brings with it. Off, the sweep is just the sweep.
      </p>
      <SaveError code={err} />
    </section>
  );
}

/** Three doors into the sweep's own admin. They all land on the same screen — the admin
 *  tabs are React state, not addresses, so there is nothing finer to link to — which is
 *  fine, because the door is not the point: the count on it is. */
function Operations({ s }) {
  const waiting = s.members.total - s.members.registered;
  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Running it</h2>
      <p className="ac-b">These happen inside the sweep, where the teams and the fixtures are.</p>
      <a className="ac-op" href={`/s/${s.id}/admin`}>
        <b>Members</b>
        <span>{s.members.total} in the sweep{waiting > 0 ? ` · ${waiting} not joined yet` : ""}</span>
      </a>
      <a className="ac-op" href={`/s/${s.id}/admin`}>
        <b>Run the draw</b>
        <span>Hand the teams out</span>
      </a>
      <a className="ac-op" href={`/s/${s.id}/admin`}>
        <b>Photos &amp; open bets</b>
        <span>Whatever is waiting on you</span>
      </a>
    </section>
  );
}

function Archive({ s }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function archive() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true); setErr(false);
    // A full navigation, not a state update: this page is about a sweep that no longer
    // belongs on the list, and the rail beside it is now wrong too.
    try { await archiveSweep(s.id); goTo("/account"); }
    catch { setErr(true); setConfirm(false); setBusy(false); }
  }

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Archive this sweep</h2>
      <p className="ac-b">
        It drops off your list and stops counting toward your subscription. Nothing is
        deleted — the picks, the scores and the photos all stay where they are.
      </p>
      <button className="ac-ghost is-danger" style={{ marginTop: 12 }} disabled={busy} onClick={archive}>
        {confirm ? "Really archive?" : "Archive"}
      </button>
      {err && <p className="ac-warn">Archive failed — try again</p>}
    </section>
  );
}

export function SweepSettings({ id }) {
  const [state, setState] = useState("loading"); // loading | ready | missing | error
  const [sweep, setSweep] = useState(null);
  // The same six cards the console's front page draws, about this sweep only. Its own
  // request, and its own failure: the charts are the half of this page you came to look
  // at, and the settings are the half you came to change — losing one must not cost the
  // other, so a rejected stats load simply leaves the story out.
  const [story, setStory] = useState(null);

  useEffect(() => {
    let alive = true;
    getAccountStats().then(
      (all) => { if (alive) setStory(all.find((x) => x.sweepId === id) ?? null); },
      () => {},
    );
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    // The same cached list the rail is drawn from — this page needs one sweep out of it,
    // not a request of its own.
    getAccountSweeps().then(
      (all) => {
        if (!alive) return;
        const s = all.find((x) => x.id === id && x.role !== "member" && !x.archivedAt);
        setSweep(s ?? null);
        setState(s ? "ready" : "missing");
      },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [id]);

  return (
    <Console here={id}>
      {state === "loading" && <p className="ac-sub">One moment…</p>}
      {state === "error" && <p className="ac-warn">Couldn't load that sweep. Reload the page.</p>}
      {/* The API 404s a sweep you do not own rather than 403ing it, so an id cannot be
          probed to learn which sweeps exist. This says the same thing. */}
      {state === "missing" && (
        <>
          <h1 className="ac-h1">Nothing here</h1>
          <p className="ac-sub">That is not a sweep you run — it may have been archived.</p>
          <a className="lp-btn ac-btn" href="/account">Back to your sweeps</a>
        </>
      )}
      {state === "ready" && (
        <>
          <Identity s={sweep} />
          {/* How it is going, before what you can change about it. */}
          {story && <div style={{ marginTop: 22 }}><SweepStory s={story} /></div>}
          <h2 className="ac-group" style={{ marginTop: 26 }}>What you can change</h2>
          <div className="ac-stack" style={{ marginTop: 14 }}>
            <Share s={sweep} />
            <Settings s={sweep} />
            <Operations s={sweep} />
            <Archive s={sweep} />
          </div>
          {/* Billing is ONE account-level subscription whose quantity is the number of
              sweeps you run. A Cancel button on each of twelve sweep pages would teach
              the owner that sweeps are billed one by one, and pressing it would stop all
              twelve — so the pill and the real controls stay on the account. */}
          <p className="ac-b">
            <a className="ac-inline" href="/account">Billed with your account</a> — one
            subscription, priced by how many sweeps you run.
          </p>
        </>
      )}
    </Console>
  );
}
