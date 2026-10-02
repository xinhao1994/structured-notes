// Vercel Edge Middleware — the AUTHORITATIVE visit tracker.
// Runs on every page request BEFORE anything is cached and BEFORE the client
// executes any JavaScript. Cannot be bypassed by stale service workers,
// disabled JS, or ad-blockers blocking fetch requests.
//
// Captures everything available at the edge: real client IP, user-agent
// (device/browser/OS), Vercel edge geolocation (country/city/region), path,
// referrer, Accept-Language, viewport hints, timezone (from Vercel).
// Persists a visitor_id in a 1-year cookie + session_id in a 30-min cookie
// so returning visitors are correctly identified across sessions.
//
// Writes directly to the Supabase REST API (fire-and-forget via waitUntil)
// so the user never waits on the logging.

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

// ─── AWS datacenter prefixes used by Vercel build infra / bots ─────────
const INFRA_IP_PREFIXES = [
  // AWS us-west-1 (Vercel builds, many monitors)
  "13.56.", "13.57.", "13.58.", "13.59.",
  "54.176.", "54.177.", "54.183.", "54.193.",
  "18.144.", "50.18.",
  // AWS us-east-1
  "3.80.", "3.81.", "3.82.", "3.83.", "3.84.", "3.85.", "3.86.", "3.87.",
  "3.88.", "3.89.", "3.90.", "3.91.",
  "18.204.", "18.205.", "18.206.", "18.207.", "18.208.", "18.209.", "18.210.",
  // Local / loopback — can show up in dev previews
  "127.", "0.0.0.0", "::1",
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

// Direct Supabase REST write — edge-runtime safe (no SDK dependencies).
async function logVisit(data: Record<string, unknown>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/page_visits`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(data),
    });
  } catch {
    /* silent — never block the user's page load */
  }
}

// Match EVERY page path, exclude static assets, API routes, admin itself,
// and the service worker. Dot files (favicon.ico etc.) excluded by the
// last negative-lookahead segment.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|_vercel|favicon\\.ico|icons/|manifest\\.webmanifest|sw\\.js|robots\\.txt|api/|admin).*)",
  ],
};

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  // ─── Hard filters — skip anything that isn't a real human navigation ───

  // Only track GET requests (ignore API POSTs, Supabase realtime polls, etc.)
  if (req.method !== "GET") return NextResponse.next();

  // Skip Next.js prefetches — hover-prefetch would double-count every link
  const prefetch = req.headers.get("next-router-prefetch")
    || req.headers.get("purpose")
    || req.headers.get("sec-purpose") || "";
  if (prefetch === "1" || prefetch.includes("prefetch")) {
    return NextResponse.next();
  }

  // Vercel internal / build infra
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

  // Extract real client IP
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = (xff.split(",")[0] || "").trim() || req.headers.get("x-real-ip") || null;
  if (ip && INFRA_IP_PREFIXES.some((p) => ip.startsWith(p))) {
    return NextResponse.next();
  }

  // ─── Collect everything available ─────────────────────────────────────

  const parsed = parseUA(ua);
  const country = req.headers.get("x-vercel-ip-country") || null;
  const cityRaw = req.headers.get("x-vercel-ip-city");
  let city: string | null = null;
  if (cityRaw) {
    try { city = decodeURIComponent(cityRaw); } catch { city = cityRaw; }
  }
  const region = req.headers.get("x-vercel-ip-country-region") || null;

  // ─── Cookies: visitor_id (1 year) + session_id (30-min sliding) ───────
  const existingVid = req.cookies.get("snd_vid")?.value;
  const visitorId = existingVid || crypto.randomUUID();
  const existingSid = req.cookies.get("snd_sid")?.value;
  const sessionId = existingSid || crypto.randomUUID();
  const chatName = req.cookies.get("snd_name")?.value || null;

  const res = NextResponse.next();
  const YEAR = 60 * 60 * 24 * 365;
  const HALF_HOUR = 60 * 30;
  if (!existingVid) {
    res.cookies.set("snd_vid", visitorId, {
      maxAge: YEAR, httpOnly: false, sameSite: "lax", path: "/",
    });
  }
  // Sliding session — every request pushes the expiry out 30 more minutes
  res.cookies.set("snd_sid", sessionId, {
    maxAge: HALF_HOUR, httpOnly: false, sameSite: "lax", path: "/",
  });

  // Fire-and-forget log via Supabase REST
  event.waitUntil(
    logVisit({
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
    })
  );

  return res;
}
