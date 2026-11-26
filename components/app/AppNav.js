"use client";
import { useEffect, useRef } from "react";
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
  const ref = useRef(null);
  // on a phone the bar scrolls sideways: keep the page you are on in view
  useEffect(() => { ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [path]);
  return (
    <nav ref={ref} className={className} aria-label="App">
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
