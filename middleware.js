import { NextResponse } from "next/server";

// Fast path only: no session cookie -> sign-in page. The real check (cookie -> session in the database) runs in
// app/app/layout.js, so a forged cookie still gets nothing. The redirect is built on APP_URL: behind nginx the
// request URL carries the internal address (127.0.0.1:3000), not the public site.
export function middleware(req) {
  if (!req.cookies.get("cx_session")?.value) {
    const base = process.env.APP_URL || req.nextUrl.origin;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(req.nextUrl.pathname)}`, base));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
