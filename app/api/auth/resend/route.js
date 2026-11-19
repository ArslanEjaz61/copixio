import { NextResponse } from "next/server";
import { currentUser, issueToken, sameOrigin } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { sendVerifyEmail } from "@/lib/mail";

// Send the verification email again (signed-in, not yet verified; at most 3 per hour).
export async function POST(req) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Request refused." }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.emailVerifiedAt) return NextResponse.json({ ok: true, already: true });
  if (!(await limit(`resend:${user._id}`, 3, 3600, { failClosed: true })))
    return NextResponse.json({ error: "We already sent 3 emails this hour. Check your spam folder." }, { status: 429 });
  const token = await issueToken(user._id, "verify", 24);
  const mail = await sendVerifyEmail(user.email, token).catch(() => ({ sent: false }));
  return NextResponse.json({ ok: true, sent: mail.sent });
}
