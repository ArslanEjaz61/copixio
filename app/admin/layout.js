import "../app/app.css";
import "./admin.css";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/Logo";
import { AdminNav } from "@/components/admin/AdminNav";
import { LogoutButton } from "@/components/app/AppNav";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Copixio Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }) {
  const me = await currentUser();
  if (!me) redirect("/login?next=/admin");
  if (me.role !== "admin") notFound();
  await db();
  const pending = await Payment.countDocuments({ status: "submitted" });
  return (
    <div className="ap ad">
      <aside className="ap-side">
        <div className="ad-brand"><Brand href="/admin" size={28} /><span className="ad-badge">Admin</span></div>
        <AdminNav pending={pending} />
        <Link className="ad-back" href="/app">← My trading account</Link>
        <div className="ap-user">
          <b>{me.name || "Admin"}</b>
          <span>{me.email}</span>
          <LogoutButton />
        </div>
      </aside>
      <div>
        <div className="ap-mobilebar">
          <div className="ad-brand"><Brand href="/admin" size={24} /><span className="ad-badge">Admin</span></div>
          <AdminNav className="" pending={pending} />
        </div>
        <main className="ap-main">{children}</main>
      </div>
    </div>
  );
}
