import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { clientMeta, codeSignup, createSession, issueCode, sameOrigin, verifyPassword } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { sendCodeEmail } from "@/lib/mail";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

// A fixed hash to compare against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);
const WRONG = "That email and password do not match. Check both and try again.";

export async function POST(req) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Request refused." }, { status: 403 });
  let body;
  try { body = Body.parse(await req.json()); }
  catch { return NextResponse.json({ error: WRONG }, { status: 400 }); }

  const { ip } = await clientMeta();
  const okIp = await limit(`login:ip:${ip}`, 30, 900, { failClosed: true });
  const okMail = await limit(`login:mail:${body.email}`, 8, 900, { failClosed: true });
  if (!okIp || !okMail) return NextResponse.json({ error: "Too many attempts. Wait 15 minutes, then try again." }, { status: 429 });

  await db();
  const user = await User.findOne({ email: body.email });
  const good = await verifyPassword(body.password, user ? user.passwordHash : DUMMY);
  if (!user || !good) return NextResponse.json({ error: WRONG }, { status: 401 });

  // 24 Nov: an account whose email was never confirmed gets a code instead of a session
  if (codeSignup() && !user.emailVerifiedAt) {
    if (!(await limit(`code-send:${user.email}`, 6, 3600, { failClosed: true })))
      return NextResponse.json({ error: "We already sent several codes to this email. Check spam, or try again in an hour." }, { status: 429 });
    const code = await issueCode(user._id);
    const mail = await sendCodeEmail(user.email, code).catch(() => ({ sent: false }));
    if (!mail.sent) return NextResponse.json({ error: "We could not send the confirmation email. Try again in a minute." }, { status: 502 });
    return NextResponse.json({ ok: true, next: "code", email: user.email });
  }

  user.lastLoginAt = new Date();
  // the admin role is never granted here: it is set on the server with scripts/make-admin.mjs (an email that anyone
  // could register first must not become admin by itself)
  await user.save();
  await createSession(user._id);
  return NextResponse.json({ ok: true });
}
