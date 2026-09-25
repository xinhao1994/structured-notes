"use client";

// VisitTracker — mounts once in the root layout, fires POST /api/track on
// every path change (initial mount + subsequent navigations). Manages a
// stable per-browser visitor_id (localStorage) + a session_id (sessionStorage
// — resets when browser tab closes). Silent — never breaks the app.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const NAME_KEY = "snd.chat.senderName.v1";
const VISITOR_KEY = "snd.visitor_id";
const SESSION_KEY = "snd.session_id";

function safeUUID(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback if randomUUID isn't available (very old browsers)
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreate(store: Storage, key: string): string {
  try {
    let v = store.getItem(key);
    if (!v) { v = safeUUID(); store.setItem(key, v); }
    return v;
  } catch { return ""; }
}

export function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const visitorId = getOrCreate(window.localStorage, VISITOR_KEY);
    const sessionId = getOrCreate(window.sessionStorage, SESSION_KEY);
    let chatName = "";
    try { chatName = window.localStorage.getItem(NAME_KEY) || ""; } catch {}

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        visitorId,
        sessionId,
        chatName,
        path: pathname,
        referrer: document.referrer || "",
      }),
    }).catch(() => {}); // silent
  }, [pathname]);

  return null;
}
