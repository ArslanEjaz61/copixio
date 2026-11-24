import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { clientMeta, codeSignup, createSession, hashPassword, issueCode, issueToken, sameOrigin } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { sendCodeEmail, sendVerifyEmail } from "@/lib/mail";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  plan: z.enum(["starter", "pro", "desk"]).optional(),
});

export async function POST(req) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Request refused." }, { status: 403 });
  const { ip } = await clientMeta();
  if (!(await limit(`signup:${ip}`, 8, 3600, { failClosed: true })))
    return NextResponse.json({ error: "Too many sign-ups from this network. Try again in an hour." }, { status: 429 });

  let body;
  try { body = Body.parse(await req.json()); }
  catch (e) {
    const issue = e?.issues?.[0];
    return NextResponse.json({ error: issue?.message || "Check the form and try again.", field: issue?.path?.[0] }, { status: 400 });
  }

  await db();
  const codeOn = codeSignup();
  const existing = await User.findOne({ email: body.email });
  // 24 Nov: with sign-up codes on, an account that never confirmed its email can sign up again (new name/password)
  if (existing && !(codeOn && !existing.emailVerifiedAt))
    return NextResponse.json({ error: "An account with this email already exists. Sign in instead.", field: "email" }, { status: 409 });

  // Free trial: Starter limits for TRIAL_DAYS (7) from sign-up, so a new user's bot trades as soon as it is set up.
  // TRIAL_DAYS=0 turns it off (pay first). With codes on it starts again when the email is confirmed.
  const trialDays = Number(process.env.TRIAL_DAYS ?? 7);
  const trial = trialDays > 0 ? { plan: "starter", planUntil: new Date(Date.now() + trialDays * 864e5), trial: true } : {};
  const fields = { name: body.name, email: body.email, passwordHash: await hashPassword(body.password), wantedPlan: body.plan || null, ...trial };
  const user = existing ? Object.assign(existing, fields) : new User(fields);
  await user.save();

  // 24 Nov: the account opens only after the 6-digit code from the email is entered (no session before that)
  if (codeOn) {
    if (!(await limit(`code-send:${user.email}`, 6, 3600, { failClosed: true })))
      return NextResponse.json({ error: "We already sent several codes to this email. Check spam, or try again in an hour." }, { status: 429 });
    const code = await issueCode(user._id);
    const mail = await sendCodeEmail(user.email, code).catch((e) => { console.log(`[mail] code to ${user.email} failed: ${e.message}`); return { sent: false }; });
    if (!mail.sent) return NextResponse.json({ error: "We could not send the confirmation email. Try again in a minute." }, { status: 502 });
    return NextResponse.json({ ok: true, next: "code", email: user.email });
  }
  const token = await issueToken(user._id, "verify", 24);
  const mail = await sendVerifyEmail(user.email, token).catch(() => ({ sent: false }));
  await createSession(user._id);
  return NextResponse.json({ ok: true, verifyMailSent: mail.sent });
}
