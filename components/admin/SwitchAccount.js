"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Signs the current (non-admin) account out and opens sign-in, which returns to the admin panel.
export function SwitchAccount() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-ink btn-block" type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      router.replace("/login?next=/admin");
      router.refresh();
    }}>
      {busy ? "Signing out…" : "Sign in with the admin account"}
    </button>
  );
}
