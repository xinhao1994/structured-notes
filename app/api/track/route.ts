// POST /api/track — logs a single page visit into page_visits.
// Fire-and-forget from the client. Silently succeeds (never breaks the page).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UAInfo { deviceType: string; browser: string; os: string; }

function parseUA(ua: string): UAInfo {
  const isTablet = /iPad|Android(?!.*Mobile)|Tablet/.test(ua);
  const isMobile = /Mobile|iPhone|iPod|Android/.test(ua) && !isTablet;
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  // Browser detection — order matters (Chrome UA also contains "Safari" etc.)
  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser/.test(ua)) browser = "Samsung";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

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
  } else if (/Linux/.test(ua)) {
    os = /CrOS/.test(ua) ? "Chrome OS" : "Linux";
  }
  return { deviceType, browser, os };
}

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  // Never fail the client if tracking is misconfigured — silent no-op.
  if (!supa) return NextResponse.json({ ok: false });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const s = (v: unknown, max = 200) => String(v ?? "").slice(0, max) || null;
  const visitorId = s(body.visitorId, 64);
  const sessionId = s(body.sessionId, 64);
  const chatName  = s(body.chatName,  64);
  const path      = s(body.path,      200);
  const referrer  = s(body.referrer,  500);

  const ua = req.headers.get("user-agent") || "";
  const parsed = parseUA(ua);

  // Real client IP — x-forwarded-for is a comma-separated chain, first is client
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = (xff.split(",")[0] || "").trim() || req.headers.get("x-real-ip") || null;

  // Geolocation from Vercel edge headers (free on every deployment)
  const country = req.headers.get("x-vercel-ip-country") || null;
  const cityRaw = req.headers.get("x-vercel-ip-city");
  const city = cityRaw ? (() => { try { return decodeURIComponent(cityRaw); } catch { return cityRaw; } })() : null;
  const region = req.headers.get("x-vercel-ip-country-region") || null;

  try {
    await supa.from("page_visits").insert({
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
    });
  } catch {}

  return NextResponse.json({ ok: true }, {
    headers: { "cache-control": "no-store" },
  });
}
