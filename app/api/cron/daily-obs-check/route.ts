// GET /api/cron/daily-obs-check
//
// Invoked once a day by Vercel Cron (configured in vercel.json at 01:00 UTC,
// which is 09:00 Malaysia time). For each push subscription:
//   1. Compute today's date in the subscription's timezone (default: KL).
//   2. For each pocket tranche, compute its KO schedule and look for an
//      observation matching today's date.
//   3. If any matches found, build a single notification payload
//      summarising them and send via web-push.
//   4. Delete subscriptions that report 410 / 404 (browser unsubscribed).
//
// Protected by header `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron
// automatically adds this when CRON_SECRET env var is set. External callers
// without the secret get 401.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, type PushSubscriptionRow } from "@/lib/supabase";
import { sendPush } from "@/lib/webpush";
import { koSchedule } from "@/lib/calc";
import type { Tranche } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — plenty for a few hundred sends

interface PocketEntry { id: string; tranche: Tranche; }

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
function todayInTz(tz: string): string {
  try {
    // en-CA gives ISO-style YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    // Bad TZ — fall back to UTC+8 (Malaysia) manually.
    const my = new Date(Date.now() + 8 * 3600_000);
    return my.toISOString().slice(0, 10);
  }
}

export async function GET(req: NextRequest) {
  // Auth — Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
  // when CRON_SECRET env var is set.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.headers.get("authorization") || "";
    if (got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { data, error } = await supa.from("push_subscriptions").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const subs = (data || []) as PushSubscriptionRow[];

  const stats = { subscriptions: subs.length, sent: 0, skipped: 0, removed: 0, errors: 0 };
  const removeEndpoints: string[] = [];

  for (const sub of subs) {
    const tz = sub.timezone || "Asia/Kuala_Lumpur";
    const today = todayInTz(tz);
    const pocket = (sub.pocket_tranches || []) as PocketEntry[];

    // Find observations falling today across all the user's tranches.
    const matches: Array<{ code: string; obsN: number; underlyings: string[] }> = [];
    for (const entry of pocket) {
      try {
        const sched = koSchedule(entry.tranche);
        const todayObs = sched.find((o) => o.date === today);
        if (todayObs) {
          matches.push({
            code: entry.tranche.trancheCode,
            obsN: todayObs.n,
            underlyings: entry.tranche.underlyings.map((u) => u.symbol),
          });
        }
      } catch { /* skip malformed tranches */ }
    }

    if (matches.length === 0) { stats.skipped++; continue; }

    // Build the push payload.
    const title = matches.length === 1
      ? `Observation today: ${matches[0].code}`
      : `${matches.length} tranches have observations today`;
    const lines = matches.map((m) =>
      `${m.code}: obs #${m.obsN} · ${m.underlyings.join(" · ")}`
    );
    const payload = {
      title,
      body: lines.join("\n") + "\n\nOpen the app for the gap-to-KO breakdown.",
      tag: `daily-obs-${today}`,
      url: "/pocket",
    };

    const res = await sendPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
      payload
    );
    if (res.ok) {
      stats.sent++;
    } else if (res.gone) {
      stats.removed++;
      removeEndpoints.push(sub.endpoint);
    } else {
      stats.errors++;
    }
  }

  // Clean up dead subscriptions in one delete.
  if (removeEndpoints.length > 0) {
    await supa.from("push_subscriptions").delete().in("endpoint", removeEndpoints);
  }

  return NextResponse.json({ ok: true, ...stats, ranAt: new Date().toISOString() });
}
