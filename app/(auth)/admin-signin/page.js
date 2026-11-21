import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SwitchAccount } from "@/components/admin/SwitchAccount";

export const metadata = { title: "Admin sign-in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Shown when someone opens /admin while signed in with an account that is not an admin.
export default async function AdminSignin() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/admin");
  if (me.role === "admin") redirect("/admin");
  return (
    <>
      <div>
        <h1>Admin panel</h1>
        <p className="lead">You are signed in as <b>{me.email}</b>, which is not an admin account. Sign in with the admin account to open the panel.</p>
      </div>
      <SwitchAccount />
      <p className="au-alt"><a href="/app">Back to my account</a></p>
    </>
  );
}
