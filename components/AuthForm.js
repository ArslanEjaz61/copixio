"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Sign-up and sign-in share one form: same fields minus name, same error handling.
export default function AuthForm({ mode }) {
  const router = useRouter();
  const sp = useSearchParams();
  const plan = sp.get("plan");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [field, setField] = useState(null);
  const signup = mode === "signup";

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setField(null);
    const f = new FormData(e.currentTarget);
    const body = { email: f.get("email"), password: f.get("password") };
    if (signup) { body.name = f.get("name"); if (["starter", "pro", "desk"].includes(plan)) body.plan = plan; }
    try {
      const r = await fetch(`/api/auth/${signup ? "signup" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Something went wrong. Try again."); setField(j.field || null); setBusy(false); return; }
      const next = sp.get("next") || "";
      router.replace(signup ? "/app?welcome=1" : /^\/app(\/[\w\-/]*)?$/.test(next) ? next : "/app");
      router.refresh();
    } catch {
      setErr("Could not reach Copixio. Check your connection and try again.");
      setBusy(false);
    }
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
