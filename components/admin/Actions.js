"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(body) {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, error: j.error || (!r ? "Could not reach Copixio. Try again." : undefined) };
}

export function PaymentActions({ id }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function decide(decision) {
    let note;
    if (decision === "reject") { note = window.prompt("Reason shown to the user (optional)"); if (note === null) return; }
    else if (!window.confirm("Approve this payment? The user's plan starts right away.")) return;
    setBusy(true); setErr(null);
    const j = await post({ action: "payment", id, decision, note: note || undefined });
    setBusy(false);
    if (j.ok) router.refresh(); else setErr(j.error);
  }
  return (
    <span className="actions">
      <button className="btn btn-ink sm" type="button" disabled={busy} onClick={() => decide("approve")}>Approve</button>
      <button className="btn-text danger" type="button" disabled={busy} onClick={() => decide("reject")}>Reject</button>
      {err && <span className="hint err" role="alert">{err}</span>}
    </span>
  );
}

export function PlanSetter({ userId, plan }) {
  const router = useRouter();
  const [p, setP] = useState(plan && plan !== "none" ? plan : "starter");
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg(null);
    const j = await post({ action: "plan", userId, plan: p, days: Number(days) || 0 });
    setBusy(false);
    if (j.ok) { setMsg("Saved"); router.refresh(); } else setMsg(j.error);
  }
  return (
    <div className="ad-form">
      <label className="ad-field"><span>Plan</span>
        <select className="input" value={p} onChange={(e) => setP(e.target.value)}>
          {[["starter", "Starter"], ["pro", "Pro"], ["desk", "Desk"], ["none", "No plan"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="ad-field"><span>Days from today</span>
        <input className="input num" type="number" min="0" max="3660" value={days} onChange={(e) => setDays(e.target.value)} />
      </label>
      <button className="btn btn-ink sm" type="button" disabled={busy} onClick={save}>Set plan</button>
      {msg && <span className={`hint${msg === "Saved" ? "" : " err"}`} role="status">{msg}</span>}
    </div>
  );
}

export function PauseToggle({ userId, paused }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function flip() {
    if (!paused && !window.confirm("Pause this user's bot? No new trades are placed until it is switched back on. Open trades stay protected.")) return;
    setBusy(true); setErr(null);
    const j = await post({ action: "pause", userId, paused: !paused });
    setBusy(false);
    if (j.ok) router.refresh(); else setErr(j.error);
  }
  return (
    <span className="actions">
      <button className={`btn sm ${paused ? "btn-ink" : "btn-line"}`} type="button" disabled={busy} onClick={flip}>{paused ? "Switch bot on" : "Pause bot"}</button>
      {err && <span className="hint err" role="alert">{err}</span>}
    </span>
  );
}
