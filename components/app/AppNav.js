"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export const NAV = [
  ["/app", "Dashboard"],
  ["/app/connections", "Connections"],
  ["/app/groups", "Signal groups"],
  ["/app/favourites", "Favourites"],
  ["/app/trades", "Trades"],
  ["/app/billing", "Billing"],
  ["/app/settings", "Settings"],
];

export function AppNav({ className = "ap-nav", admin = false }) {
  const path = usePathname();
  return (
    <nav className={className} aria-label="App">
      {(admin ? [...NAV, ["/admin", "Admin panel"]] : NAV).map(([href, label]) => (
        <Link key={href} href={href} aria-current={path === href || (href !== "/app" && path?.startsWith(href + "/")) ? "page" : undefined}>{label}</Link>
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
