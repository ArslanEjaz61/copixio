"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const ADMIN_NAV = [
  ["/admin", "Overview"],
  ["/admin/users", "Users"],
  ["/admin/payments", "Payments"],
  ["/admin/trades", "Trades"],
  ["/admin/signals", "Signals"],
];

export function AdminNav({ className = "ap-nav", pending = 0 }) {
  const path = usePathname();
  return (
    <nav className={className} aria-label="Admin">
      {ADMIN_NAV.map(([href, label]) => {
        const on = path === href || (href !== "/admin" && path?.startsWith(href + "/"));
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined}>
            {label}
            {href === "/admin/payments" && pending > 0 && <small className="ad-count" aria-label={`${pending} waiting`}>{pending}</small>}
          </Link>
        );
      })}
    </nav>
  );
}
