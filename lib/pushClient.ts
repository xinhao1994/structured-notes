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

export interface SubscribeResult { ok: boolean; reason?: string; endpoint?: string; }

export async function requestSubscribe(pocket: PocketEntry[]): Promise<SubscribeResult> {
  if (typeof window === "undefined") return { ok: false, reason: "no window" };
  if (!("Notification" in window)) return { ok: false, reason: "notifications unsupported" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "push API unsupported (iOS Safari requires Add to Home Screen first)" };
  }
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublic) return { ok: false, reason: "VAPID public key not configured on server" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "permission denied" };

  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, reason: "service worker not ready" };

  // Reuse an existing subscription if there is one (key must match)
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await sub.unsubscribe(); } catch {}
  }
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublic),
    });
  } catch (e: any) {
    return { ok: false, reason: `subscribe failed: ${e?.message || e}` };
  }

  const j = sub.toJSON();
  const endpoint = j.endpoint!;
  const p256dh = j.keys?.p256dh!;
  const auth = j.keys?.auth!;
  if (!endpoint || !p256dh || !auth) return { ok: false, reason: "subscription missing keys" };

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
    return { ok: false, reason: j?.error || `server responded ${res.status}` };
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
