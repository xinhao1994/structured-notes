// trackEvent — fire-and-forget button click logger.
// Sends to /api/track-event; never throws, never blocks the UI.

const VISITOR_KEY = "snd.visitor_id";
const SESSION_KEY = "snd.session_id";
const NAME_KEY    = "snd.chat.senderName.v1";
const ADMIN_KEY   = "snd.admin_device";

function isAdminDevice(): boolean {
  try { return window.localStorage.getItem(ADMIN_KEY) === "1"; } catch { return false; }
}

export function trackEvent(
  buttonName: string,
  meta?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (isAdminDevice()) return;
  try {
    const visitorId  = window.localStorage.getItem(VISITOR_KEY)  || "";
    const sessionId  = window.sessionStorage.getItem(SESSION_KEY) || "";
    const chatName   = window.localStorage.getItem(NAME_KEY)      || "";
    const page       = window.location.pathname;
    const payload = JSON.stringify({ visitorId, sessionId, chatName, buttonName, page, meta });
    fetch("/api/track-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: payload,
    }).catch(() => {});
  } catch {}
}
