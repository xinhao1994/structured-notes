"use client";
// Browser-side helpers for managing the Web Push subscription that drives
// the daily 9am-Malaysia notification from the Vercel Cron.
//
// Flow:
//   1. User taps "Enable scheduled morning alerts" → requestSubscribe()
//   2. We ask for Notification permission, register the service worker, and
//      create a push subscription using the VAPID public key.
//   3. POST the subscription + current pocket to /api/push/subscribe.
//   4. From then on, whenever the pocket changes, syncPocket() is called.
//   5. unsubscribe() removes the row + revokes the browser subscription.

import type { PocketEntry } from "./storage";

const ENDPOINT_KEY = "snd.push.endpoint.v1";

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + "===".slice(0, (4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // ServiceWorkerRegister already calls register("/sw.js") on mount —
    // we just wait for it to be ready.
    return await navigator.serviceWorker.ready;
  } catch { return null; }
}

export interface SubscribeResult {
  ok: boolean;
  /** Short machine code so the UI can decide which guidance to show. */
  reasonCode?: "no-window" | "ios-needs-install" | "browser-unsupported" | "ios-old-version" | "no-vapid" | "permission-denied" | "sw-not-ready" | "subscribe-failed" | "server-error" | "missing-keys";
  /** Human-readable explanation that's safe to show in a generic error UI. */
  reason?: string;
  endpoint?: string;
}

/** Best-effort iOS detection. Modern iPads on iPadOS 13+ report as Mac, but
 *  Mac has no touch, so the maxTouchPoints check catches them. */
function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
}

/** Is the page running as an installed PWA (from home-screen icon)? */
function isInstalledPWA(): boolean {
  if (typeof window === "undefined") return false;
  // iOS-specific Safari hint
  if ((window.navigator as any).standalone === true) return true;
  try { return window.matchMedia("(display-mode: standalone)").matches; } catch { return false; }
}

export async function requestSubscribe(pocket: PocketEntry[]): Promise<SubscribeResult> {
  if (typeof window === "undefined") return { ok: false, reasonCode: "no-window", reason: "no window" };

  // iOS-specific guidance — Apple hides the Notification API in regular
  // Safari tabs. It's only available when the page launches from an
  // installed PWA icon on the home screen, AND iOS 16.4 or later.
  if (isIOSDevice()) {
    if (!isInstalledPWA()) {
      return {
        ok: false,
        reasonCode: "ios-needs-install",
        reason: "iOS needs the app installed to your home screen first. Push notifications don't work from regular Safari tabs.",
      };
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return {
        ok: false,
        reasonCode: "ios-old-version",
        reason: "iOS 16.4 or later is required for push notifications. Update iOS in Settings → General → Software Update.",
      };
    }
  }

  if (!("Notification" in window)) {
    return { ok: false, reasonCode: "browser-unsupported", reason: "This browser does not support Notifications." };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reasonCode: "browser-unsupported", reason: "This browser does not support Push (need Chrome, Edge, Firefox, or installed iOS Safari)." };
  }
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublic) return { ok: false, reasonCode: "no-vapid", reason: "VAPID public key not configured on server. Check /api/setup-status." };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reasonCode: "permission-denied", reason: "Notification permission denied. Enable in iOS Settings → Notifications → Structured Notes." };

  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, reasonCode: "sw-not-ready", reason: "Service worker not ready. Close and reopen the app." };

  let sub = await reg.pushManager.getSubscription();
  if (sub) { try { await sub.unsubscribe(); } catch {} }
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublic),
    });
  } catch (e: any) {
    return { ok: false, reasonCode: "subscribe-failed", reason: `Subscribe failed: ${e?.message || e}` };
  }

  const j = sub.toJSON();
  const endpoint = j.endpoint!;
  const p256dh = j.keys?.p256dh!;
  const auth = j.keys?.auth!;
  if (!endpoint || !p256dh || !auth) return { ok: false, reasonCode: "missing-keys", reason: "Push subscription missing keys." };

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: { endpoint, keys: { p256dh, auth } },
      pocket,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kuala_Lumpur",
    }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, reasonCode: "server-error", reason: j?.error || `Server responded ${res.status}. If this is "Supabase not configured", check /api/setup-status.` };
  }

  try { localStorage.setItem(ENDPOINT_KEY, endpoint); } catch {}
  return { ok: true, endpoint };
}

export async function syncPocket(pocket: PocketEntry[]): Promise<boolean> {
  if (typeof window === "undefined") return false;
  let endpoint: string | null = null;
  try { endpoint = localStorage.getItem(ENDPOINT_KEY); } catch {}
  if (!endpoint) return false;
  try {
    const res = await fetch("/api/push/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, pocket }),
    });
    return res.ok;
  } catch { return false; }
}

export async function unsubscribe(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  let endpoint: string | null = null;
  try { endpoint = localStorage.getItem(ENDPOINT_KEY); } catch {}
  const reg = await ensureServiceWorker();
  if (reg) {
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
  }
  if (endpoint) {
    try {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    } catch {}
  }
  try { localStorage.removeItem(ENDPOINT_KEY); } catch {}
  return true;
}

export function isSubscribedLocally(): boolean {
  if (typeof window === "undefined") return false;
  try { return !!localStorage.getItem(ENDPOINT_KEY); } catch { return false; }
}

/** Exposed so the UI can render iOS-specific install instructions before
 *  the user even taps Enable. */
export function detectPlatform(): { isIOS: boolean; isInstalled: boolean; canSubscribe: boolean } {
  const isIOS = isIOSDevice();
  const isInstalled = isInstalledPWA();
  const canSubscribe =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  return { isIOS, isInstalled, canSubscribe };
}
