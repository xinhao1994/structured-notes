// POST /api/track — logs a single page visit into page_visits.
// Called by Edge Middleware (middleware.ts) on every page request. The
// middleware passes the authoritative edge-captured data in the JSON body
// (because when middleware proxies via fetch, this route sees middleware's
// own headers, not the original user's).
//
// Also accepts legacy client-side calls (older cached JS may still POST
// here); in that case we fall back to extracting IP/UA/geo from the
// request headers.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const BOT_PATTERNS = [
  "bot", "spider", "crawler", "curl", "wget", "python-requests",
  "node-fetch", "axios", "okhttp", "java/", "go-http-client",
  "headless", "phantomjs", "selenium", "playwright", "puppeteer",
  "uptimerobot", "pingdom", "statuscake", "monitor", "prerender",
  "vercel-screenshot", "vercel-favicon", "vercel-og", "lighthouse",
  "facebookexternalhit", "twitterbot", "slackbot", "whatsapp",
  "discordbot", "linkedinbot",
];

function isBot(ua: string): boolean {
  if (!ua) return true;
  if (!/Mozilla/i.test(ua)) return true;
  const lower = ua.toLowerCase();
  return BOT_PATTERNS.some((p) => lower.includes(p));
}

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) {
    console.log("[track] no supabase admin client — missing env vars");
    return NextResponse.json({ ok: false, reason: "no-supabase" });
  }

  // Was this called by our Edge Middleware? If so, the body is authoritative.
  const fromMiddleware = req.headers.get("x-mw-forwarded") === "1";

  let body: any = {};
  try { body = await req.json(); } catch {}

  const s = (v: unknown, max = 500) => {
    const str = String(v ?? "").slice(0, max);
    return str || null;
  };

  // ─── Resolve each field: middleware body first, then header fallback ───
  const ua = fromMiddleware
    ? (s(body.userAgent) || "")
    : (req.headers.get("user-agent") || "");

  if (!fromMiddleware && isBot(ua)) {
    // Client-side legacy call from a bot — skip
    return NextResponse.json({ ok: true, skipped: "bot" });
  }

  const parsed = parseUA(ua);

  const ip = fromMiddleware
    ? s(body.ip, 64)
    : ((req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim()
        || req.headers.get("x-real-ip") || null;

  const country = fromMiddleware ? s(body.country, 8) : (req.headers.get("x-vercel-ip-country") || null);

  let city: string | null = null;
  if (fromMiddleware) {
    city = s(body.city, 128);
  } else {
    const cityRaw = req.headers.get("x-vercel-ip-city");
    if (cityRaw) { try { city = decodeURIComponent(cityRaw); } catch { city = cityRaw; } }
  }

  const region = fromMiddleware ? s(body.region, 64) : (req.headers.get("x-vercel-ip-country-region") || null);

  const visitorId = s(body.visitorId, 64);
  const sessionId = s(body.sessionId, 64);
  const chatName  = s(body.chatName,  64);
  const path      = s(body.path,      200);
  const referrer  = s(body.referrer,  500);

  const row = {
    visitor_id: visitorId,
    session_id: sessionId,
    chat_name: chatName,
    ip,
    country,
    city,
    region,
    user_agent: ua.slice(0, 500) || null,
    device_type: parsed.deviceType,
    browser: parsed.browser,
    os: parsed.os,
    path,
    referrer,
  };

  let inserted: any = null;
  try {
    const { data, error } = await supa
      .from("page_visits")
      .insert(row)
      .select()
      .single();
    if (error) {
      console.log(`[track] supabase insert error: ${error.message}`);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    inserted = data;
  } catch (e: any) {
    console.log(`[track] insert threw: ${String(e?.message || e)}`);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  // ─── Broadcast the new visit so the admin dashboard sees it instantly ───
  // Dashboard subscribes to the "snd:visits:feed" channel. This is the same
  // mechanism the chat uses for "two Tims appear" — a Supabase Realtime
  // broadcast, delivered within ~500 ms to every connected client.
  try {
    const channel = supa.channel("snd:visits:feed");
    await channel.subscribe();
    await channel.send({
      type: "broadcast",
      event: "new_visit",
      payload: inserted,
    });
    await supa.removeChannel(channel);
  } catch (e: any) {
    // Broadcasting is best-effort — the dashboard will still catch it on
    // the next 3-second poll even if broadcast fails.
    console.log(`[track] broadcast failed: ${String(e?.message || e).slice(0,120)}`);
  }

  return NextResponse.json({ ok: true, visit: inserted }, { headers: { "cache-control": "no-store" } });
}
