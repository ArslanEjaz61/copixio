import { NextResponse } from "next/server";

// Fast path only: no session cookie -> sign-in page. The real check (cookie -> session in the database) runs in
// app/app/layout.js, so a forged cookie still gets nothing.
export function middleware(req) {
  if (!req.cookies.get("cx_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
