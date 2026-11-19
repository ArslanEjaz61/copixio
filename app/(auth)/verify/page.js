import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { consumeToken } from "@/lib/auth";

export const metadata = { title: "Confirm your email" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }) {
  const { token } = await searchParams;
  const userId = await consumeToken(String(token || ""), "verify");
  if (userId) { await db(); await User.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } }); }
  return userId ? (
    <>
      <div><h1>Email confirmed</h1><p className="lead">Thanks. Next, connect your exchange.</p></div>
      <a className="btn btn-ink btn-block" href="/app">Go to your dashboard</a>
    </>
  ) : (
    <>
      <div><h1>This link does not work</h1><p className="lead">It may have expired (links last 24 hours) or been used already. Sign in and send a new one from your dashboard.</p></div>
      <a className="btn btn-ink btn-block" href="/login">Sign in</a>
    </>
  );
}
