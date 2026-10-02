// Vercel Edge Middleware — the AUTHORITATIVE visit tracker.
// Runs on every page request BEFORE anything is cached and BEFORE the client
// executes any JavaScript. Cannot be bypassed by stale service workers,
// disabled JS, or ad-blockers blocking fetch requests.
//
// Flow: middleware extracts everything available at the edge (real client IP,
// user-agent, geolocation, cookies) then fire-and-forget POSTs it to
// /api/track, which runs in Node.js with the Supabase service role key.
// We don't write to Supabase directly from edge because env var access and
// REST fetch latency are flakier there — proxying through /api/track gives
// us a known-good Node runtime path.

import { NextRequest, NextResponse, NextFetchEvent } from "next/server";

// ─── Bot / scraper / infra User-Agent patterns to IGNORE ───────────────
const BOT_PATTERNS = [
  "bot", "spider", "crawler", "curl", "wget", "python-requests",
  "node-fetch", "axios", "okhttp", "java/", "go-http-client",
  "headless", "phantomjs", "selenium", "playwright", "puppeteer",
  "uptimerobot", "pingdom", "statuscake", "monitor", "prerender",
  "vercel-screenshot", "vercel-favicon", "vercel-og", "lighthouse",
  "facebookexternalhit", "twitterbot", "slackbot", "whatsapp",
  "discordbot", "linkedinbot", "preview-service",
];

// Match EVERY page path, exclude static assets, API routes, admin itself,
// and the service worker.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|_vercel|favicon\\.ico|icons/|manifest\\.webmanifest|sw\\.js|robots\\.txt|api/|admin).*)",
  ],
};

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  // ─── Hard filters — skip anything that isn't a real human navigation ───
  if (req.method !== "GET") return NextResponse.next();

  const prefetch = req.headers.get("next-router-prefetch")
    || req.headers.get("purpose")
    || req.headers.get("sec-purpose") || "";
  if (prefetch === "1" || prefetch.includes("prefetch")) {
    return NextResponse.next();
  }

  if (req.headers.get("x-vercel-sc-host")
    || req.headers.get("x-vercel-deployment-url")
    || req.headers.get("x-vercel-internal")) {
    return NextResponse.next();
  }

  const ua = req.headers.get("user-agent") || "";
  if (!ua || !/Mozilla/i.test(ua)) return NextResponse.next();
  const lowerUA = ua.toLowerCase();
  if (BOT_PATTERNS.some((p) => lowerUA.includes(p))) {
    return NextResponse.next();
  }

  // ─── Cookies: visitor_id (1 year) + session_id (30-min sliding) ───────
  const existingVid = req.cookies.get("snd_vid")?.value;
  const visitorId = existingVid || crypto.randomUUID();
  const existingSid = req.cookies.get("snd_sid")?.value;
  const sessionId = existingSid || crypto.randomUUID();
  const chatName = req.cookies.get("snd_name")?.value || null;

  // Build response and set/refresh cookies
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

  // Extract edge headers to forward in the body — /api/track runs in Node and
  // sees the middleware's own fetch headers, not the original user's headers,
  // so we must pass everything explicitly.
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = (xff.split(",")[0] || "").trim() || req.headers.get("x-real-ip") || null;
  const country = req.headers.get("x-vercel-ip-country") || null;
  const cityRaw = req.headers.get("x-vercel-ip-city");
  let city: string | null = null;
  if (cityRaw) {
    try { city = decodeURIComponent(cityRaw); } catch { city = cityRaw; }
  }
  const region = req.headers.get("x-vercel-ip-country-region") || null;
  const referrer = req.headers.get("referer") || null;
  const path = req.nextUrl.pathname;

  // Fire-and-forget POST to /api/track (Node runtime, has Supabase env vars)
  const trackUrl = new URL("/api/track", req.nextUrl.origin).toString();
  event.waitUntil(
    fetch(trackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass the authoritative edge data as headers too for completeness
        "x-mw-forwarded": "1",
      },
      body: JSON.stringify({
        visitorId, sessionId, chatName,
        ip, country, city, region,
        userAgent: ua.slice(0, 500),
        path, referrer,
      }),
    }).then(async (r) => {
      // Log the result so Vercel runtime logs show us what happened
      if (!r.ok) {
        console.log(`[mw-track] HTTP ${r.status} for ${path}`);
      }
    }).catch((e) => {
      console.log(`[mw-track] fetch error: ${String(e)}`);
    })
  );

  return res;
}
