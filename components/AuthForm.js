"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Sign-up and sign-in share one form: same fields minus name, same error handling.
// 24 Nov: when the server asks for it, a second step takes the 6-digit code sent to the email.
export default function AuthForm({ mode }) {
  const router = useRouter();
  const sp = useSearchParams();
  const plan = sp.get("plan");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [field, setField] = useState(null);
  const [codeFor, setCodeFor] = useState(null); // email waiting for its code
  const [wait, setWait] = useState(0);
  const [note, setNote] = useState(null);
  const signup = mode === "signup";

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function goIn() {
    const next = sp.get("next") || "";
    router.replace(signup ? "/app?welcome=1" : /^\/(app|admin)(\/[\w\-/]*)?$/.test(next) ? next : "/app");
    router.refresh();
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return [r, await r.json().catch(() => ({}))];
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setField(null);
    const f = new FormData(e.currentTarget);
    const body = { email: f.get("email"), password: f.get("password") };
    if (signup) { body.name = f.get("name"); if (["starter", "pro", "desk"].includes(plan)) body.plan = plan; }
    try {
      const [r, j] = await post(`/api/auth/${signup ? "signup" : "login"}`, body);
      if (!r.ok) { setErr(j.error || "Something went wrong. Try again."); setField(j.field || null); setBusy(false); return; }
      if (j.next === "code") { setCodeFor(j.email); setWait(30); setNote(null); setBusy(false); return; }
      goIn();
    } catch {
      setErr("Could not reach Copixio. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function onCode(e) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") || "").replace(/\D/g, "");
    setBusy(true); setErr(null); setNote(null);
    try {
      const [r, j] = await post("/api/auth/code", { email: codeFor, code });
      if (!r.ok) { setErr(j.error || "That code did not work. Try again."); setBusy(false); return; }
      goIn();
    } catch {
      setErr("Could not reach Copixio. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const [r, j] = await post("/api/auth/code", { email: codeFor, resend: true });
      if (!r.ok) setErr(j.error || "Could not send a new code. Try again.");
      else setNote(`A new code was sent to ${codeFor}.`);
    } catch { setErr("Could not reach Copixio. Check your connection and try again."); }
    setWait(30); setBusy(false);
  }

  if (codeFor) {
    return (
      <form className="au-form" onSubmit={onCode} noValidate>
        <p className="hint" role="status">We sent a 6-digit code to <b>{codeFor}</b>. Enter it to finish {signup ? "creating your account" : "signing in"}. Check the spam folder if you do not see it.</p>
        <div className="field">
          <label htmlFor="code">Confirmation code</label>
          <input className="input num" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="••••••" required autoFocus />
        </div>
        {err && <div className="note bad" role="alert">{err}</div>}
        {note && <div className="note" role="status">{note}</div>}
        <button className="btn btn-ink btn-block" type="submit" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button>
        <p className="hint">
          {wait > 0 ? <>Didn&apos;t get the code? You can ask again in {wait} s.</> : (
            <button className="btn-text" type="button" disabled={busy} onClick={resend}>Didn&apos;t get the code? Send again</button>
          )}
          {" · "}<button className="btn-text" type="button" onClick={() => { setCodeFor(null); setErr(null); setNote(null); }}>Use another email</button>
        </p>
      </form>
    );
  }

  return (
    <form className="au-form" onSubmit={onSubmit} noValidate>
      {signup && (
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" autoComplete="name" required maxLength={80} aria-invalid={field === "name"} />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required aria-invalid={field === "email"} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : 1} aria-invalid={field === "password"} aria-describedby={signup ? "pw-hint" : undefined} />
        {signup && <span className="hint" id="pw-hint">At least 10 characters.</span>}
      </div>
      {err && <div className="note bad" role="alert">{err}</div>}
      <button className="btn btn-ink btn-block" type="submit" disabled={busy}>
        {busy ? (signup ? "Creating your account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
