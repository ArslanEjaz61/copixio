"use client";
import { useState } from "react";

async function post(body) {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, error: j.error || (!r ? "Could not reach Copixio." : undefined) };
}

export function PaymentActions({ id }) {
  const [state, setState] = useState(null);
  if (state === "done") return <span className="pill info">Done, reload</span>;
  return (
    <span className="actions">
      <button className="btn btn-ink sm" type="button" disabled={state === "busy"} onClick={async () => { setState("busy"); const j = await post({ action: "payment", id, decision: "approve" }); setState(j.ok ? "done" : j.error); }}>Approve</button>
      <button className="btn-text danger" type="button" disabled={state === "busy"} onClick={async () => { const note = window.prompt("Reason shown to the user (optional)") ?? null; if (note === null) return; setState("busy"); const j = await post({ action: "payment", id, decision: "reject", note }); setState(j.ok ? "done" : j.error); }}>Reject</button>
      {state && !["busy", "done"].includes(state) && <span className="hint err">{state}</span>}
    </span>
  );
}

export function PlanSetter({ userId, plan }) {
  const [p, setP] = useState(plan);
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState(null);
  return (
    <span className="actions" style={{ flexWrap: "nowrap" }}>
      <select className="input" style={{ width: 110, padding: "6px 8px" }} value={p} onChange={(e) => setP(e.target.value)}>{["none", "starter", "pro", "desk"].map((x) => <option key={x}>{x}</option>)}</select>
      <input className="input num" style={{ width: 70, padding: "6px 8px" }} type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} aria-label="days" />
      <button className="btn btn-line sm" type="button" onClick={async () => { const j = await post({ action: "plan", userId, plan: p, days }); setMsg(j.ok ? "Saved" : j.error); }}>Set</button>
      {msg && <span className="hint">{msg}</span>}
    </span>
  );
}
