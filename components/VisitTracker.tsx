"use client";

// VisitTracker — the AUTHORITATIVE visit + presence logger. Replaces the
// Supabase Realtime presence approach (which was unreliable on mobile Safari:
// the WebSocket drops every few seconds on cellular, triggering false
// "leave" events that made Signal keep disappearing from the dashboard).
//
// New model — pure HTTP, 100% reliable:
//   1. On every page view: POST /api/track           → creates a visit row
//   2. Every 15s while the tab is visible: POST /api/track {mode:"heartbeat"}
//                                                   → UPDATEs last_heartbeat_at
//   3. On tab close (pagehide + visibilitychange→hidden):
//                     sendBeacon /api/track {mode:"offline"}
//                                                   → UPDATEs offline_at
//
// The admin dashboard considers a visitor LIVE when their latest row has
//   offline_at IS NULL  AND  last_heartbeat_at >= NOW() - 45 seconds
// So a phone can miss up to 2 consecutive heartbeats before showing offline,
// which comfortably covers cellular jitter.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const NAME_KEY = "snd.chat.senderName.v1";
const VISITOR_KEY = "snd.visitor_id";
const SESSION_KEY = "snd.session_id";
// If this flag is set in localStorage, we treat the device as the admin's
// own and skip ALL tracking. The admin dashboard has a one-click toggle.
export const ADMIN_DEVICE_KEY = "snd.admin_device";

// Kept exported so existing imports in AdminDashboard don't break — but the
// dashboard no longer uses it; we use heartbeat timestamps instead.
export const GLOBAL_PRESENCE_CHANNEL = "snd:presence:global";

const HEARTBEAT_MS = 15_000;

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

function isAdminDevice(): boolean {
  try { return window.localStorage.getItem(ADMIN_DEVICE_KEY) === "1"; }
  catch { return false; }
}

function shouldSkip(pathname: string | null): boolean {
  if (isAdminDevice()) return true;
  if (pathname && pathname.startsWith("/admin")) return true;
  return false;
}

async function post(mode: "visit" | "heartbeat" | "offline", pathname: string | null) {
  try {
    const visitorId = window.localStorage.getItem(VISITOR_KEY) || "";
    const sessionId = window.sessionStorage.getItem(SESSION_KEY) || "";
    const chatName  = window.localStorage.getItem(NAME_KEY) || "";
    const payload = JSON.stringify({
      visitorId, sessionId, chatName,
      path: pathname || "/",
      referrer: mode === "visit" ? (document.referrer || "") : mode,
      mode,
    });
    if (mode === "offline") {
      // Beacon is the only API that reliably fires during unload
      try {
        const blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon?.("/api/track", blob)) return;
      } catch {}
    }
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: payload,
    }).catch(() => {});
  } catch {}
}

export function VisitTracker() {
  const pathname = usePathname();
  const trackedPathRef = useRef<string>("");

  // Ensure identifiers exist on mount so heartbeats can reference them
  useEffect(() => {
    if (typeof window === "undefined") return;
    getOrCreate(window.localStorage, VISITOR_KEY);
    getOrCreate(window.sessionStorage, SESSION_KEY);
  }, []);

  // ─── Fire a VISIT POST on every path change ──────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (shouldSkip(pathname)) return;
    if (trackedPathRef.current === pathname) return;
    trackedPathRef.current = pathname || "";
    post("visit", pathname);
  }, [pathname]);

  // ─── 15-second heartbeat while the tab is visible ────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (shouldSkip(pathname)) return;

    const beat = () => {
      if (document.visibilityState === "visible") post("heartbeat", pathname);
    };
    // Fire one right away so the dashboard knows the user is active without
    // waiting the full 15 seconds
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_MS);
    // When the tab becomes visible again (e.g. phone unlocked), heartbeat
    // immediately so Live Now updates fast
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pathname]);

  // ─── Final OFFLINE beacon on actual tab close ────────────────────────
  // Only pagehide — NOT visibilitychange. The heartbeat going stale (no
  // ping in 45s) already handles backgrounded tabs, so firing offline on
  // every background→foreground cycle would create unwanted flicker.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (shouldSkip(pathname)) return;
    const onPageHide = () => post("offline", pathname);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [pathname]);

  return null;
}
