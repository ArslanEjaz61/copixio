import "./app.css";
import { redirect } from "next/navigation";
import { Brand } from "@/components/Logo";
import { AppNav, LogoutButton } from "@/components/app/AppNav";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function AppLayout({ children }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="ap">
      <aside className="ap-side">
        <Brand href="/app" size={28} />
        <AppNav admin={user.role === "admin"} />
        <div className="ap-user">
          <b>{user.name || "Your account"}</b>
          <span>{user.email}</span>
          <LogoutButton />
        </div>
      </aside>
      <div>
        <div className="ap-mobilebar">
          <Brand href="/app" size={24} />
          <AppNav className="" admin={user.role === "admin"} />
        </div>
        <main className="ap-main">{children}</main>
      </div>
    </div>
  );
}
