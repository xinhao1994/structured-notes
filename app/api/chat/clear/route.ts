// POST /api/chat/clear  → wipes the chat history.
//
// The anon role can only INSERT (per RLS). To clear the table we need the
// service_role, which only the server has. This endpoint is the bridge.
// No auth — anyone with the deployed app URL can call it. For a small
// private team this is acceptable; tighten with a shared password if you
// ever publish more widely.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const { error } = await supa.from("chat_messages").delete().not("id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
