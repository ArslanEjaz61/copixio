"use client";
import { useState } from "react";

export default function ResendVerify() {
  const [state, setState] = useState(null);
  return (
    <span>
      <button
        className="btn btn-line"
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await fetch("/api/auth/resend", { method: "POST" }).catch(() => null);
          const j = r ? await r.json().catch(() => ({})) : {};
          setState(!r ? "Could not reach Copixio." : r.ok ? "Sent. Check your inbox and spam folder." : j.error || "Try again later.");
        }}
      >
        {state === "busy" ? "Sending…" : "Send the email again"}
      </button>
      {state && state !== "busy" && <span className="hint" role="status" style={{ marginLeft: 12 }}>{state}</span>}
    </span>
  );
}
