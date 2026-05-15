"use client";
// Encode / decode a Tranche for transport inside a chat_messages.body field.
// Used by:
//   - Pocket page → "Share to chat" button (encodes + supabase.insert)
//   - Chat page   → renders a TrancheCard when attachment_type === "tranche"

import type { Tranche } from "./types";

export const TRANCHE_PREFIX = "[[TRANCHE]]";

export function encodeTranche(t: Tranche): string {
  if (typeof window === "undefined") return "";
  const json = JSON.stringify(t);
  return TRANCHE_PREFIX + window.btoa(unescape(encodeURIComponent(json)));
}

export function decodeTranche(body: string): Tranche | null {
  if (typeof window === "undefined") return null;
  if (!body.startsWith(TRANCHE_PREFIX)) return null;
  try {
    const b64 = body.slice(TRANCHE_PREFIX.length);
    const json = decodeURIComponent(escape(window.atob(b64)));
    return JSON.parse(json) as Tranche;
  } catch { return null; }
}
