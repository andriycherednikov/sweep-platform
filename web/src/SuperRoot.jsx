/* ============================================================
   THE SWEEP — standalone mount for the super-admin console.

   The super console is reachable on the platform host with only a SUPER
   cookie — the operator has NOT joined a sweep, so the SweepProvider Gate's
   bootstrap would 401 and block it. main.jsx mounts this OUTSIDE the Gate for
   /super[/​<token>] so minting the first sweep is possible (chicken-and-egg).
   ============================================================ */
import { useState, useCallback } from "react";
import { SuperConsole } from "./screens-super.jsx";

export function SuperRoot({ autoToken }) {
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <>
      <SuperConsole
        autoToken={autoToken}
        onToast={showToast}
        onBack={() => window.location.assign("/")}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
