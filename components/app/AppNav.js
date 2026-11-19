"use client";
import { usePathname, useRouter } from "next/navigation";

export const NAV = [
  ["/app", "Dashboard"],
  ["/app/exchanges", "Exchanges"],
  ["/app/telegram", "Telegram groups"],
  ["/app/trades", "Trades"],
  ["/app/billing", "Billing"],
  ["/app/settings", "Settings"],
];

export function AppNav({ className = "ap-nav" }) {
  const path = usePathname();
  return (
    <nav className={className} aria-label="App">
      {NAV.map(([href, label]) => (
        <a key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</a>
      ))}
    </nav>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="ap-logout"
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
