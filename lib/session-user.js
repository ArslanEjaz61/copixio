import "server-only";
import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "./auth";

// Guard for API routes: same-origin for writes, a signed-in user always. Returns [user, null] or [null, response].
export async function apiUser(req, { write = false, admin = false } = {}) {
  if (write && !(await sameOrigin(req))) return [null, NextResponse.json({ error: "Request refused." }, { status: 403 })];
  const user = await currentUser();
  if (!user) return [null, NextResponse.json({ error: "Sign in again." }, { status: 401 })];
  if (admin && user.role !== "admin") return [null, NextResponse.json({ error: "Not allowed." }, { status: 403 })];
  return [user, null];
}

export const bad = (error, status = 400, extra = {}) => NextResponse.json({ error, ...extra }, { status });
export const ok = (data = {}) => NextResponse.json({ ok: true, ...data });
