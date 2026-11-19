"use client";
import { useState } from "react";

export default function CloseTrade({ id, base }) {
  const [state, setState] = useState(null);
  if (state === "done") return <span className="pill info">Closing…</span>;
  return (
    <span>
      <button className="btn btn-line sm" type="button" disabled={state === "busy"} onClick={async () => {
        if (!window.confirm(`Sell all ${base} now at market price?`)) return;
        setState("busy");
        const r = await fetch(`/api/trades/${id}/close`, { method: "POST" }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        setState(r && r.ok ? "done" : j.error || "Could not close. Try again.");
      }}>{state === "busy" ? "Closing…" : "Close"}</button>
      {state && !["busy", "done"].includes(state) && <span className="hint err" style={{ marginLeft: 8 }}>{state}</span>}
    </span>
  );
}
