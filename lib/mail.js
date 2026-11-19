import "server-only";
import nodemailer from "nodemailer";

// SMTP from env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM). Without SMTP the message is written to the
// server log so setup can be finished before a mailbox exists; the function says which happened.
let transport = null;
function tx() {
  if (transport || !process.env.SMTP_HOST) return transport;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const t = tx();
  if (!t) {
    console.log(`[mail:not-configured] to=${to} subject="${subject}"\n${text}`);
    return { sent: false };
  }
  await t.sendMail({ from: process.env.MAIL_FROM || "Copixio <no-reply@copixio.com>", to, subject, text });
  return { sent: true };
}

export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export async function sendVerifyEmail(email, token) {
  const link = `${appUrl()}/verify?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: email,
    subject: "Confirm your Copixio email",
    text: `Confirm your email to finish setting up Copixio:\n\n${link}\n\nThe link works for 24 hours. If you did not create an account, ignore this message.`,
  });
}
