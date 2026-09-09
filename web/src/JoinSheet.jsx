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
import { useState, useEffect } from "react";
import { Icon, PersonAvatar } from "./components.jsx";
import { postJoinCode, postJoinSession, postMe, uploadPhoto } from "./api/client.js";
import { getAccount, getAccountToken, clearAccountToken } from "./lib/accountClient.js";
import { setMe, toast } from "./social.js";
import { SWEEP as S } from "./data.js";

const AV_PALETTE = ["#c9472f","#3b6fd1","#1f9d57","#b8860b","#7b4bd1","#0a9396","#bb3e03","#6a4c93"];
// Mirrors api/src/people/identity.js so the preview matches the seat you get.
const initialsFor = (nm) => nm.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??";
const avFor = (nm) => AV_PALETTE[Math.abs([...nm].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % AV_PALETTE.length];

/** `blocking` renders it as a gate: no close button, and the scrim ignores clicks. Used
 *  when a link-holder has no seat yet — the sweep is visible behind it, so they can see
 *  what they are joining, but nothing in it can be operated until they are somebody. */
export function JoinSheet({ onClose, queryClient, blocking }) {
  const [step, setStep] = useState(() => (getAccountToken() ? "setup" : "email"));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  // A token in localStorage is not proof of a session — it expires, it gets revoked,
  // and in dev the row behind it can simply be gone. Trusting its mere presence dropped
  // people onto the setup form with a POST /api/me that could only 401, behind a gate
  // with no close button. Check it once on the way in, and fall back to the email step.
  const signedOut = () => {
    clearAccountToken();
    setFile(null); setNote(null);
    setStep("email");
    setErr("You're not signed in any more. Pop your email in and we'll send a fresh code.");
  };
  useEffect(() => {
    if (step !== "setup" || !getAccountToken()) return;
    let alive = true;
    getAccount().catch(() => { if (alive) signedOut(); });
    return () => { alive = false; };
    // once, on mount: a later step change is this component's own doing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One field, same as the organiser's Add-person sheet. The server derives the short
  // name and initials from the whole string either way, so two boxes only ever bought
  // a second place to leave blank.
  const name = fullName.trim().replace(/\s+/g, " ");
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
    try {
      const { person } = await postJoinSession(email, code);
      // Coming back is not joining: the seat is already there, with a name on it. Asking
      // a returning member to type it again was the whole complaint.
      if (person) {
        setMe(person.id);
        queryClient?.invalidateQueries({ queryKey: ["sweep"] });
        toast(`Welcome back, ${person.short}`);
        onClose?.();
        return;
      }
      setStep("setup");
    }
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
        fd.append("kind", "profile"); fd.append("file", file);
        // The photo is a bonus, never a gate: a failed upload must not cost someone the
        // seat they just took, so this swallows and carries on.
        await uploadPhoto(fd).catch(() => null);
      }
      queryClient?.invalidateQueries({ queryKey: ["sweep"] });
      toast(`You're in as ${person.short}`);
      onClose?.();
    } catch (e2) {
      // A session can lapse between opening this sheet and submitting it.
      if (e2?.status === 401) { signedOut(); setBusy(false); return; }
      setErr(e2?.status === 403
        ? "You're not able to join this sweep. Ask whoever runs it."
        : "Couldn't finish that just now. Try again.");
      setBusy(false);
    }
  }

  // One door for both: we cannot know whether this address is already in the sweep until
  // they give it to us, so the copy must not promise either.
  const head = step === "email" ? "Sign in" : step === "code" ? "Check your email" : "Set yourself up";

  return (
    <div className="overlay" onClick={blocking ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90%" }}>
        <div className="grab"></div>
        <div className="sheet-head">
          <h3>{head}</h3>
          {!blocking && <button className="x" onClick={onClose}><Icon.x/></button>}
        </div>
        <div className="sheet-body">
          {err && <p role="alert" style={{ fontSize: 13, color: "var(--accent)", margin: "0 0 12px" }}>{err}</p>}

          {step === "email" && (
            <form onSubmit={sendCode}>
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
                Already in this sweep? This signs you back in, with your teams, picks and
                wagers where you left them. New here? It sets you up.
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
              <div className="join-face">
                <PersonAvatar p={preview} cls="pav join-face-av" style={{ width: 84, height: 84, fontSize: 30 }} />
                {/* A bare text link under the avatar read as a caption, not a control —
                    which is why "add a photo" looked like it did not work. */}
                <label className="join-face-btn">
                  {note ? "Change photo" : "Add a photo"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden
                         aria-label="Add a photo"
                         onChange={(e) => { setFile(e.target.files?.[0] ?? null); setNote(e.target.files?.[0]?.name ?? null); }} />
                </label>
                {note && <p className="join-face-name">{note}</p>}
              </div>
              <div className="field">
                <label htmlFor="join-name">Your name</label>
                <input id="join-name" required autoFocus autoComplete="name" maxLength={80}
                       placeholder="e.g. Macca McCallum"
                       value={fullName} onChange={(e) => setFullName(e.target.value)} />
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
