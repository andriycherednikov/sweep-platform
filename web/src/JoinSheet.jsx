/* ============================================================
   THE SWEEP — the join journey.

   One sheet, three steps: email → six-digit code → your name and face.
   It replaces the "Who are you?" picker, which asked the device to name a
   person and then took its word for it. Here the server decides: the code
   proves the address, the address is an account, and the account holds a seat.

   Opening with an account token already stored starts on `setup` — which is
   both the "already registered, sign them straight in" branch and the path an
   owner takes to play in their own sweep.
   ============================================================ */
import { useState } from "react";
import { Icon, PersonAvatar } from "./components.jsx";
import { postJoinCode, postJoinSession, postMe, uploadPhoto } from "./api/client.js";
import { getAccountToken } from "./lib/accountClient.js";
import { setMe, toast } from "./social.js";
import { SWEEP as S } from "./data.js";

const AV_PALETTE = ["#c9472f","#3b6fd1","#1f9d57","#b8860b","#7b4bd1","#0a9396","#bb3e03","#6a4c93"];
// Mirrors api/src/people/identity.js so the preview matches the seat you get.
const initialsFor = (nm) => nm.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??";
const avFor = (nm) => AV_PALETTE[Math.abs([...nm].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % AV_PALETTE.length];

export function JoinSheet({ onClose, queryClient }) {
  const [step, setStep] = useState(() => (getAccountToken() ? "setup" : "email"));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const name = [first.trim(), last.trim()].filter(Boolean).join(" ");
  const preview = { initials: name ? initialsFor(name) : "?", av: name ? avFor(name) : "var(--muted2)" };

  async function sendCode(e) {
    e?.preventDefault();
    setErr(null); setBusy(true);
    try { await postJoinCode(email); setCode(""); setStep("code"); }
    catch { setErr("Couldn't send that just now. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function verify(e) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await postJoinSession(email, code); setStep("setup"); }
    catch { setErr("That code doesn't match, or it's expired. Send yourself a fresh one."); }
    finally { setBusy(false); }
  }

  async function join(e) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const person = await postMe(name);
      setMe(person.id);
      if (file) {
        const fd = new FormData();
        fd.append("kind", "profile"); fd.append("uploaderName", name); fd.append("file", file);
        // The photo is a bonus, never a gate: a failed or queued upload must not cost
        // someone the seat they just took.
        const shot = await uploadPhoto(fd).catch(() => null);
        if (shot && shot.status === "pending") {
          toast("You're in — your photo is with the organiser for approval");
        }
      }
      queryClient?.invalidateQueries({ queryKey: ["sweep"] });
      toast(`You're in as ${person.short}`);
      onClose();
    } catch (e2) {
      setErr(e2?.message?.includes("403")
        ? "You're not able to join this sweep. Ask whoever runs it."
        : "Couldn't finish that just now. Try again.");
      setBusy(false);
    }
  }

  const head = step === "email" ? "Join this sweep" : step === "code" ? "Check your email" : "Set yourself up";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90%" }}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>{head}</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          {err && <p role="alert" style={{ fontSize: 13, color: "var(--accent)", margin: "0 0 12px" }}>{err}</p>}

          {step === "email" && (
            <form onSubmit={sendCode}>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
                {S.people.length > 0
                  ? `${S.people.length} ${S.people.length === 1 ? "person is" : "people are"} already in. `
                  : ""}
                Your email keeps your teams, picks and wagers with you on any device.
              </p>
              <div className="field">
                <label htmlFor="join-email">Your email</label>
                <input id="join-email" type="email" required autoFocus autoComplete="email"
                       placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button className="cta" type="submit" disabled={busy}>{busy ? "Sending…" : "Send my code"}</button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={verify}>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
                We sent a six-digit code to <b>{email}</b>. It works once, and it expires in 15 minutes.
              </p>
              <div className="field">
                <label htmlFor="join-code">Your code</label>
                {/* one-time-code lets iOS and Android offer it straight from the notification */}
                <input id="join-code" className="join-code" inputMode="numeric" autoComplete="one-time-code"
                       pattern="[0-9]{6}" maxLength={6} required autoFocus placeholder="000000"
                       value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </div>
              <button className="cta" type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Continue"}
              </button>
              <button className="cta ghost" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={() => sendCode()}>
                Send it again
              </button>
              <button className="cta ghost" type="button" style={{ marginTop: 8 }}
                      onClick={() => { setErr(null); setStep("email"); }}>
                Use a different email
              </button>
              {import.meta.env.DEV && (
                <p style={{ fontSize: 11.5, color: "var(--muted2)", textAlign: "center", marginTop: 12 }}>
                  (dev: the code is printed on the API console)
                </p>
              )}
            </form>
          )}

          {step === "setup" && (
            <form onSubmit={join}>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
                This is how the group will see you.
              </p>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                <label style={{ cursor: "pointer", textAlign: "center" }}>
                  <PersonAvatar p={preview} cls="pav" style={{ width: 84, height: 84, fontSize: 30 }} />
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
                         aria-label="Add a photo" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setNote(e.target.files?.[0]?.name ?? null); }} />
                  <span style={{ display: "block", fontSize: 12, color: "var(--accent)", marginTop: 8 }}>
                    {note ? "Change photo" : "Add a photo (optional)"}
                  </span>
                </label>
              </div>
              <div className="field">
                <label htmlFor="join-first">First name</label>
                <input id="join-first" required autoFocus autoComplete="given-name" maxLength={40}
                       value={first} onChange={(e) => setFirst(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="join-last">Last name</label>
                <input id="join-last" autoComplete="family-name" maxLength={40}
                       value={last} onChange={(e) => setLast(e.target.value)} />
              </div>
              <button className="cta" type="submit" disabled={busy || !name}>
                {busy ? "Joining…" : "Join the sweep"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
