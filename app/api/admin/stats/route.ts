// GET /api/admin/stats?token=<ADMIN_TOKEN>
//
// Returns aggregate chat statistics: total unique names ever registered,
// total messages, first/last message timestamps, and a per-user breakdown.
// Protected by a shared secret in the ADMIN_TOKEN env var — set it in
// Vercel to a random string only you know, then hit the URL with that
// token as either a query param (?token=xxx) or an x-admin-token header.
//
// Required env vars:
//   ADMIN_TOKEN                 — the shared secret you'll type in the URL
//   NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL (already set)
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase admin key (already set)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin endpoint disabled — set ADMIN_TOKEN env var in Vercel to enable." },
      { status: 503 }
    );
  }

  // Auth — accept either ?token=xxx or x-admin-token header. Use a constant-time
  // comparison so a timing attacker can't brute-force the token character by
  // character. (Not that anyone's likely to try, but it costs nothing.)
  const supplied =
    req.nextUrl.searchParams.get("token") ??
    req.headers.get("x-admin-token") ??
    "";
  if (!constantTimeEqual(supplied, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supa = getSupabaseAdmin();
  if (!supa) {
    return NextResponse.json({ error: "Supabase admin client not configured" }, { status: 503 });
  }

  // Pull EVERY message's sender_name + created_at. For a small team the
  // volume is trivial. We aggregate in Node rather than SQL so we don't
  // need to write a stored function.
  const { data, error } = await supa
    .from("chat_messages")
    .select("sender_name, created_at")
    .order("created_at", { ascending: true })
    .limit(50_000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = { sender_name: string; created_at: string };
  const rows = (data ?? []) as Row[];

  const perUserMap = new Map<
    string,
    { name: string; messages: number; firstAt: string; lastAt: string }
  >();
  for (const r of rows) {
    const key = (r.sender_name ?? "").trim();
    if (!key) continue;
    const cur = perUserMap.get(key);
    if (!cur) {
      perUserMap.set(key, { name: key, messages: 1, firstAt: r.created_at, lastAt: r.created_at });
    } else {
      cur.messages += 1;
      if (r.created_at < cur.firstAt) cur.firstAt = r.created_at;
      if (r.created_at > cur.lastAt) cur.lastAt = r.created_at;
    }
  }

  const perUser = Array.from(perUserMap.values()).sort((a, b) => b.messages - a.messages);
  const totalMessages = rows.length;
  const uniqueNames = perUserMap.size;
  const firstMessageAt = rows[0]?.created_at ?? null;
  const lastMessageAt = rows[rows.length - 1]?.created_at ?? null;

  // Active users in the last 24h / 7d
  const now = Date.now();
  const activeCount = (windowMs: number) => {
    const since = new Date(now - windowMs).toISOString();
    return perUser.filter((u) => u.lastAt >= since).length;
  };
  const activeLast24h = activeCount(24 * 3600 * 1000);
  const activeLast7d  = activeCount(7 * 24 * 3600 * 1000);

  return NextResponse.json(
    {
      uniqueNames,
      totalMessages,
      firstMessageAt,
      lastMessageAt,
      activeLast24h,
      activeLast7d,
      perUser,
      generatedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        // Never cache admin data — always fresh
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
