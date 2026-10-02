"use client";

// VisitTracker — mounts once in the root layout. Does TWO things:
//
// 1) POST /api/track on every path change (initial mount + navigations).
//    Uses `keepalive: true` + `sendBeacon` fallback so the request survives
//    tab-close. This is the AUTHORITATIVE visit logger — the Edge Middleware
//    tracker is a backup.
//
// 2) Joins a global Supabase Realtime presence channel so the admin
//    dashboard can show a green dot for every live visitor. Presence state
//    carries visitor_id, chat_name, path, device info — the dashboard uses
//    it to render "who's on the site right now".

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

const NAME_KEY = "snd.chat.senderName.v1";
const VISITOR_KEY = "snd.visitor_id";
const SESSION_KEY = "snd.session_id";
// If this flag is set in localStorage, we treat the device as the admin's
// own and skip ALL tracking (no /api/track POSTs, no presence channel join).
// The admin dashboard provides a one-click button to set it.
export const ADMIN_DEVICE_KEY = "snd.admin_device";

// Shared constant also referenced by AdminDashboard
export const GLOBAL_PRESENCE_CHANNEL = "snd:presence:global";

function isAdminDevice(): boolean {
  try { return window.localStorage.getItem(ADMIN_DEVICE_KEY) === "1"; }
  catch { return false; }
}

function safeUUID(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {}
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreate(store: Storage, key: string): string {
  try {
    let v = store.getItem(key);
    if (!v) { v = safeUUID(); store.setItem(key, v); }
    return v;
  } catch { return ""; }
}

function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) return "tablet";
  if (/Mobile|iPhone|iPod|Android/.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

export function VisitTracker() {
  const pathname = usePathname();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const trackedPathRef = useRef<string>("");

  // ─── 1) POST /api/track on every path change ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Admin device opt-out AND /admin pages never get tracked
    if (isAdminDevice() || (pathname && pathname.startsWith("/admin"))) return;
    // Dedupe: React may double-invoke effects in strict mode
    if (trackedPathRef.current === pathname) return;
    trackedPathRef.current = pathname || "";

    const visitorId = getOrCreate(window.localStorage, VISITOR_KEY);
    const sessionId = getOrCreate(window.sessionStorage, SESSION_KEY);
    let chatName = "";
    try { chatName = window.localStorage.getItem(NAME_KEY) || ""; } catch {}

    const payload = JSON.stringify({
      visitorId, sessionId, chatName,
      path: pathname,
      referrer: document.referrer || "",
    });

    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: payload,
      }).catch(() => {
        try { navigator.sendBeacon?.("/api/track", payload); } catch {}
      });
    } catch {
      try { navigator.sendBeacon?.("/api/track", payload); } catch {}
    }
  }, [pathname]);

  // ─── 1b) On tab close / backgrounding, log one final "left" row via
  // sendBeacon so the admin's "Last seen" updates to the actual moment the
  // person went offline. sendBeacon is the only API that reliably fires
  // during an unload — fetch is cancelled by the browser.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAdminDevice() || (pathname && pathname.startsWith("/admin"))) return;

    const onLeaving = () => {
      try {
        const visitorId = window.localStorage.getItem(VISITOR_KEY) || "";
        const sessionId = window.sessionStorage.getItem(SESSION_KEY) || "";
        const chatName = window.localStorage.getItem(NAME_KEY) || "";
        const payload = JSON.stringify({
          visitorId, sessionId, chatName,
          path: pathname || "/",
          referrer: "left-site",
        });
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon?.("/api/track", blob);
      } catch {}
    };
    // pagehide fires on close + nav away + bfcache. visibilitychange catches
    // tab-hide on mobile. Both are needed for full coverage.
    const onVis = () => { if (document.visibilityState === "hidden") onLeaving(); };
    window.addEventListener("pagehide", onLeaving);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onLeaving);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pathname]);

  // ─── 2) Global presence channel — "who's on the site right now" ─────
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Admin devices don't broadcast presence either
    if (isAdminDevice()) return;
    const supa = getSupabaseBrowser();
    if (!supa) return;

    const visitorId = getOrCreate(window.localStorage, VISITOR_KEY);
    let chatName = "";
    try { chatName = window.localStorage.getItem(NAME_KEY) || ""; } catch {}

    const ch = supa.channel(GLOBAL_PRESENCE_CHANNEL, {
      config: { presence: { key: visitorId } },
    });

    ch.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      try {
        await ch.track({
          visitor_id: visitorId,
          chat_name: chatName || null,
          path: pathname || "/",
          device: detectDevice(),
          browser: detectBrowser(),
          joined_at: new Date().toISOString(),
        });
      } catch {}
    });

    channelRef.current = ch;

    return () => {
      try { ch.untrack(); } catch {}
      try { supa.removeChannel(ch); } catch {}
      channelRef.current = null;
    };
    // Only re-create the channel per visitor, not per path — we update
    // path via ch.track() in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update presence state when the path changes (same channel, no re-subscribe)
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    let chatName = "";
    try { chatName = window.localStorage.getItem(NAME_KEY) || ""; } catch {}
    const visitorId = getOrCreate(window.localStorage, VISITOR_KEY);
    ch.track({
      visitor_id: visitorId,
      chat_name: chatName || null,
      path: pathname || "/",
      device: detectDevice(),
      browser: detectBrowser(),
      updated_at: new Date().toISOString(),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
