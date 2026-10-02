// Vercel Edge Middleware — the AUTHORITATIVE visit tracker.
// Runs on every page request BEFORE the client executes JavaScript.
// Cannot be bypassed by stale service workers, disabled JS, or ad-blockers.
//
// IMPORTANT IMPLEMENTATION NOTE:
// We write to Supabase SYNCHRONOUSLY (await, not event.waitUntil). Vercel's
// edge network short-circuits waitUntil promises when the response is served
// from the SSG/ISR cache — we observed middleware running but the background
// fetch never completing. Awaiting adds ~100-200 ms per page but guarantees
// every visit is captured.

import { NextRequest, NextResponse } from "next/server";

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

interface UAInfo { deviceType: string; browser: string; os: string; }

function parseUA(ua: string): UAInfo {
  const isTablet = /iPad|Android(?!.*Mobile)|Tablet/.test(ua);
  const isMobile = /Mobile|iPhone|iPod|Android/.test(ua) && !isTablet;
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "Unknown";
  if (/Edg\//.test(ua))                browser = "Edge";
  else if (/OPR\/|Opera/.test(ua))     browser = "Opera";
  else if (/SamsungBrowser/.test(ua))  browser = "Samsung";
  else if (/CriOS\//.test(ua))         browser = "Chrome iOS";
  else if (/FxiOS\//.test(ua))         browser = "Firefox iOS";
  else if (/Chrome\//.test(ua))        browser = "Chrome";
  else if (/Firefox\//.test(ua))       browser = "Firefox";
  else if (/Safari\//.test(ua))        browser = "Safari";

  let os = "Unknown";
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = ua.match(/OS (\d+)_(\d+)/);
    os = m ? `iOS ${m[1]}.${m[2]}` : "iOS";
  } else if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+(?:\.\d+)?)/);
    os = m ? `Android ${m[1]}` : "Android";
  } else if (/Mac OS X/.test(ua)) {
    const m = ua.match(/Mac OS X (\d+)[._](\d+)/);
    os = m ? `macOS ${m[1]}.${m[2]}` : "macOS";
  } else if (/Windows NT ([\d.]+)/.test(ua)) {
    const m = ua.match(/Windows NT ([\d.]+)/);
    const v = m?.[1];
    os = v === "10.0" ? "Windows 10/11" : v ? `Windows ${v}` : "Windows";
  } else if (/CrOS/.test(ua)) {
    os = "Chrome OS";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  }
  return { deviceType, browser, os };
}

// Direct Supabase REST write — awaited so the write MUST complete before
// the response ships. Timeout at 1.5 s so a slow Supabase never breaks the
// page (we drop the log and let the user through).
async function logVisit(data: Record<string, unknown>): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("[mw] missing supabase env", { hasUrl: !!url, hasKey: !!key });
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${url}/rest/v1/page_visits`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.log(`[mw] supabase ${r.status}: ${text.slice(0,200)}`);
    }
  } catch (e: any) {
    console.log(`[mw] supabase fetch failed: ${String(e?.message || e).slice(0,200)}`);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|_vercel|favicon\\.ico|icons/|manifest\\.webmanifest|sw\\.js|robots\\.txt|api/|admin).*)",
  ],
};

export default async function middleware(req: NextRequest) {
  // ─── Hard filters — skip non-navigations and infra ─────────────────────
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

  // ─── Collect everything ────────────────────────────────────────────────
  const parsed = parseUA(ua);
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = (xff.split(",")[0] || "").trim() || req.headers.get("x-real-ip") || null;
  const country = req.headers.get("x-vercel-ip-country") || null;
  const cityRaw = req.headers.get("x-vercel-ip-city");
  let city: string | null = null;
  if (cityRaw) {
    try { city = decodeURIComponent(cityRaw); } catch { city = cityRaw; }
  }
  const region = req.headers.get("x-vercel-ip-country-region") || null;

  // Cookies: visitor_id (1 year) + session_id (30-min sliding)
  const existingVid = req.cookies.get("snd_vid")?.value;
  const visitorId = existingVid || crypto.randomUUID();
  const existingSid = req.cookies.get("snd_sid")?.value;
  const sessionId = existingSid || crypto.randomUUID();
  const chatName = req.cookies.get("snd_name")?.value || null;

  // ─── SYNCHRONOUSLY await the write ─────────────────────────────────────
  // We don't use event.waitUntil because Vercel kills the background fetch
  // when the response is served from the SSG cache. Awaiting adds ~100 ms
  // per visit but guarantees the write completes.
  await logVisit({
    visitor_id: visitorId,
    session_id: sessionId,
    chat_name: chatName,
    ip,
    country,
    city,
    region,
    user_agent: ua.slice(0, 500),
    device_type: parsed.deviceType,
    browser: parsed.browser,
    os: parsed.os,
    path: req.nextUrl.pathname,
    referrer: req.headers.get("referer") || null,
  });

  // Build the response with persistent cookies
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
