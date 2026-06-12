// web/src/InstallPrompt.jsx
import { useState } from 'react'
import { Icon, useIsDesktop } from './components.jsx'
import { useInstallPrompt } from './hooks/useInstallPrompt.js'

/* iOS Safari has no install API — guide the user through the manual gesture. */
function IosInstallSheet({ onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"60%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>Add to Home Screen</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          <p style={{fontSize:13.5,color:"var(--muted)",lineHeight:1.5,marginBottom:14}}>
            On iPhone, Safari installs apps manually:
          </p>
          <ol className="install-steps">
            <li>Tap the <b>Share</b> button <span className="install-step-ico"><Icon.share/></span> in the toolbar.</li>
            <li>Scroll down and choose <b>Add to Home Screen</b>.</li>
            <li>Tap <b>Add</b> — The Sweep lands on your home screen.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

/**
 * A slim, dismissable "Install The Sweep" banner above the bottom nav.
 * Chromium → replays the captured beforeinstallprompt from our own button.
 * iOS Safari → opens the tip sheet (no install API exists there).
 * Once dismissed it stays gone — InstallButton is the persistent re-entry point.
 */
export function InstallPrompt() {
  const { canPrompt, isIOS, promptInstall, dismiss } = useInstallPrompt()
  const [iosOpen, setIosOpen] = useState(false)
  if (!canPrompt) return null

  const onInstall = () => { if (isIOS) setIosOpen(true); else promptInstall() }

  return (
    <>
      <div className="install-bar" role="region" aria-label="Install app">
        <img className="install-icon" src="/web-app-manifest-192x192.png" alt="" />
        <div className="install-copy">
          <b>Install The Sweep</b>
          <span>Add it to your home screen — full screen, one tap away.</span>
        </div>
        <button className="install-go" onClick={onInstall}>Install</button>
        <button className="install-x" aria-label="Dismiss" onClick={dismiss}><Icon.x/></button>
      </div>
      {iosOpen && <IosInstallSheet onClose={()=>setIosOpen(false)} />}
    </>
  )
}

/**
 * Persistent install entry point (e.g. on your own profile). Unlike the banner
 * it survives dismissal — only hidden once already installed, on desktop, or
 * on a browser with no install path.
 */
export function InstallButton() {
  const { canInstall, isIOS, promptInstall } = useInstallPrompt()
  const isDesktop = useIsDesktop()
  const [iosOpen, setIosOpen] = useState(false)
  if (isDesktop || !canInstall) return null

  const onInstall = () => { if (isIOS) setIosOpen(true); else promptInstall() }

  return (
    <>
      <button className="cta ghost install-cta" onClick={onInstall}>
        <Icon.share/> Install as an app
      </button>
      {iosOpen && <IosInstallSheet onClose={()=>setIosOpen(false)} />}
    </>
  )
}
