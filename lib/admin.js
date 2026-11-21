import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "./auth.js";
import { db } from "./db.js";
import { planOf } from "./models.js";

// Every admin page calls this itself: a page renders beside its layout, so the layout's check alone is not enough.
export async function requireAdmin() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/admin");
  if (me.role !== "admin") notFound();
  await db();
  return me;
}

// How a user's account stands today: trial / paid / expired (had a plan) / none.
export function standing(u) {
  const p = planOf(u);
  if (p !== "none") return u.trial ? "trial" : "paid";
  return u.plan && u.plan !== "none" ? "expired" : "none";
}

export const STANDING = {
  trial: ["Free trial", "info"],
  paid: ["Paying", "ok"],
  expired: ["Expired", "wait"],
  none: ["No plan", "bad"],
};

export const usd = (v, sign = false) => {
  const n = Number(v || 0);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (sign ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : "") + s;
};
export const when = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "–");
export const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "–");
export const ago = (d) => {
  if (!d) return "never";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
export const px = (x) => (x === null || x === undefined ? "–" : String(Number(Number(x).toPrecision(6))));
