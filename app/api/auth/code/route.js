import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { checkCode, createSession, issueCode, sameOrigin } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { sendCodeEmail } from "@/lib/mail";

// 24 Nov: finish sign-up with the 6-digit code from the email.
// POST { email, code }          -> confirms the email, starts the trial, signs in
// POST { email, resend: true }  -> a new code (one per 30 s, 6 per hour per email)
const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email").optional(),
  resend: z.boolean().optional(),
});
const NONE = "No sign-up is waiting for this email. Sign up again.";

export async function POST(req) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Request refused." }, { status: 403 });
  let body;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: e?.issues?.[0]?.message || "Check the code and try again." }, { status: 400 }); }

  await db();
  const user = await User.findOne({ email: body.email });
  if (!user) return NextResponse.json({ error: NONE }, { status: 404 });
  if (user.emailVerifiedAt) return NextResponse.json({ error: "This email is already confirmed. Sign in instead." }, { status: 409 });

  if (body.resend) {
    if (!(await limit(`code-wait:${user.email}`, 1, 30, { failClosed: true })))
      return NextResponse.json({ error: "Wait 30 seconds before asking for another code." }, { status: 429 });
    if (!(await limit(`code-send:${user.email}`, 6, 3600, { failClosed: true })))
      return NextResponse.json({ error: "We already sent several codes to this email. Check spam, or try again in an hour." }, { status: 429 });
    const code = await issueCode(user._id);
    const mail = await sendCodeEmail(user.email, code).catch((e) => { console.log(`[mail] code to ${user.email} failed: ${e.message}`); return { sent: false }; });
    if (!mail.sent) return NextResponse.json({ error: "We could not send the email. Try again in a minute." }, { status: 502 });
    return NextResponse.json({ ok: true, sent: true });
  }

  if (!body.code) return NextResponse.json({ error: "Enter the 6-digit code from the email." }, { status: 400 });
  if (!(await limit(`code-check:${user.email}`, 15, 900, { failClosed: true })))
    return NextResponse.json({ error: "Too many tries. Wait 15 minutes, then ask for a new code." }, { status: 429 });
  const r = await checkCode(user._id, body.code);
  if (r === "wrong") return NextResponse.json({ error: "That code is not right. Check the latest email from Copixio." }, { status: 400 });
  if (r === "locked") return NextResponse.json({ error: "Too many wrong codes. Ask for a new code." }, { status: 429 });
  if (r === "expired") return NextResponse.json({ error: "This code has expired. Ask for a new code." }, { status: 410 });

  // confirmed: the free trial counts from now
  const trialDays = Number(process.env.TRIAL_DAYS ?? 7);
  const set = { emailVerifiedAt: new Date(), lastLoginAt: new Date() };
  if (user.trial && trialDays > 0) set.planUntil = new Date(Date.now() + trialDays * 864e5);
  await User.updateOne({ _id: user._id }, { $set: set });
  await createSession(user._id);
  console.log(`${new Date().toISOString()} [signup] ${user._id} confirmed by email code`);
  return NextResponse.json({ ok: true });
}
