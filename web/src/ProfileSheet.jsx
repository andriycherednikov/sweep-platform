/* ============================================================
   THE SWEEP — edit your own details.

   Replaces the photo-only upload sheet on your own profile. Name, face and the
   address you sign in with, in the one place you would look for them.

   The picture shows the crop before you commit to it: the server takes a 256×256
   centre cover-crop (api/src/photos/process.js), and the app's own avatar frame with
   object-fit:cover reproduces exactly that, so what you see is what the group gets.
   ============================================================ */
import { useState, useEffect, useRef } from "react";
import { Icon, PersonAvatar } from "./components.jsx";
import { postMe, uploadPhoto } from "./api/client.js";
import { getAccount } from "./lib/accountClient.js";
import { SWEEP as S } from "./data.js";

export function ProfileSheet({ person, onClose, onToast, queryClient }) {
  const parts = (person.name || "").trim().split(/\s+/);
  const [first, setFirst] = useState(parts[0] || "");
  const [last, setLast] = useState(parts.slice(1).join(" "));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [email, setEmail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  // The address is the account's, not the seat's — read it from the account so it is
  // right even when the roster row was created by somebody else.
  useEffect(() => {
    let alive = true;
    getAccount().then((a) => { if (alive) setEmail(a.email); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Object URLs are a resource, not a string: revoke the old one whenever it changes.
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const name = [first.trim(), last.trim()].filter(Boolean).join(" ");
  const dirty = name !== (person.name || "").trim() || !!file;

  async function save() {
    if (!name || busy || !dirty) return;
    setBusy(true); setErr(null);
    try {
      if (name !== (person.name || "").trim()) await postMe(name);
      if (file) {
        const fd = new FormData();
        fd.append("kind", "profile");
        fd.append("uploaderName", name);
        fd.append("file", file);
        await uploadPhoto(fd);
      }
      queryClient?.invalidateQueries({ queryKey: ["sweep"] });
      onToast("Profile updated");
      onClose();
    } catch {
      setErr("Couldn't save that just now. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90%" }}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>Edit your details</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          {err && <p role="alert" style={{ fontSize: 13, color: "var(--accent)", margin: "0 0 12px" }}>{err}</p>}

          {S.readOnly ? (
            <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
              Changes are paused while the sweep is read-only.
            </p>
          ) : (
          <>
            <div className="join-face">
              {/* exactly the crop the server takes: a centred square, shown round */}
              {preview
                ? <img className="pav join-face-av" src={preview} alt="" style={{ width: 96, height: 96, objectFit: "cover" }} />
                : <PersonAvatar p={person} cls="pav join-face-av" style={{ width: 96, height: 96, fontSize: 34 }} />}
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                     aria-label="Choose a photo" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" className="join-face-btn" onClick={() => inputRef.current?.click()}>
                {file ? "Change photo" : person.avatarPath ? "Replace photo" : "Add a photo"}
              </button>
              <p className="join-face-name">
                {file ? "This is how it will be cut" : "Square crop, centred"}
              </p>
            </div>

            <div className="field">
              <label htmlFor="pf-first">First name</label>
              <input id="pf-first" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="pf-last">Last name</label>
              <input id="pf-last" value={last} onChange={(e) => setLast(e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="pf-email">Email</label>
              <input id="pf-email" readOnly value={email ?? "…"} />
              <small className="field-note">
                This is how you sign in, on this device and any other. It cannot be changed here yet.
              </small>
            </div>

            <button className="cta" onClick={save} disabled={busy || !name || !dirty} style={{ marginTop: 6, opacity: dirty && name ? 1 : 0.5 }}>
              <Icon.check/> {busy ? "Saving…" : "Save"}
            </button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
