// Vercel Edge Middleware — sets persistent visitor_id/session_id cookies
// on every page request. Keeps visitor identity stable across sessions and
// across browser tabs for the same person.
//
// NOTE: The actual visit-logging is done by the client-side VisitTracker
// (components/VisitTracker.tsx), which POSTs to /api/track on every page
// view with keepalive + sendBeacon fallback. We tried doing the Supabase
// write from middleware too (fire-and-forget via event.waitUntil, and then
// synchronously via await), but both were flaky when Vercel served pages
// from the SSG cache — the client-side approach is 100% reliable and gives
// us the Supabase broadcast → dashboard pop-up in one step.

import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|_vercel|favicon\\.ico|icons/|manifest\\.webmanifest|sw\\.js|robots\\.txt|api/|admin).*)",
  ],
};

export default function middleware(req: NextRequest) {
  if (req.method !== "GET") return NextResponse.next();

  const existingVid = req.cookies.get("snd_vid")?.value;
  const visitorId = existingVid || crypto.randomUUID();
  const existingSid = req.cookies.get("snd_sid")?.value;
  const sessionId = existingSid || crypto.randomUUID();

  const res = NextResponse.next();
  const YEAR = 60 * 60 * 24 * 365;
  const HALF_HOUR = 60 * 30;
  if (!existingVid) {
    res.cookies.set("snd_vid", visitorId, {
      maxAge: YEAR, httpOnly: false, sameSite: "lax", path: "/",
    });
  }
  res.cookies.set("snd_sid", sessionId, {
    maxAge: HALF_HOUR, httpOnly: false, sameSite: "lax", path: "/",
  });
  return res;
}
