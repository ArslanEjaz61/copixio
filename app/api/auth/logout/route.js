import { NextResponse } from "next/server";
import { destroySession, sameOrigin } from "@/lib/auth";

export async function POST(req) {
  if (!(await sameOrigin(req))) return NextResponse.json({ error: "Request refused." }, { status: 403 });
  await destroySession();
  return NextResponse.json({ ok: true });
}
