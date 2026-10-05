"use client";

// SN Desk — Admin Dashboard
// ─────────────────────────
// Minimal, isolated page. Just ONE visitor table + a toggle to opt this
// device out of tracking + a chat-activity summary.
//
// Live detection is pure polling: /api/admin/data every 2 seconds. A visitor
// is ONLINE if their most recent row (any type: visit, heartbeat, offline)
// is not an "offline" marker AND created_at is within 45 seconds. The 45s
// window tolerates mobile phones missing one or two heartbeat pings.

import { useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_DEVICE_KEY } from "@/components/VisitTracker";

interface Visit {
  id: string;
  visitor_id: string | null;
  session_id: string | null;
  chat_name: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  path: string | null;
  referrer: string | null;
  created_at: string;
}
interface ChatMsg { sender_name: string; created_at: string; }
interface Payload { visits: Visit[]; messages: ChatMsg[]; generatedAt: string; }

const POLL_MS = 2000;
const LIVE_FRESH_MS = 45_000;

function isHeartbeatRow(v: Visit): boolean {
  return v.path === "__heartbeat" || v.referrer === "heartbeat";
}
function isOfflineRow(v: Visit): boolean {
  return v.path === "__offline" || v.referrer === "offline";
}
function isRealVisit(v: Visit): boolean {
  return !isHeartbeatRow(v) && !isOfflineRow(v);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function relSince(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface VisitorRow {
  rowKey: string;        // "<visitor_id>:<session_id>" — unique per session
  visitorId: string;
  sessionId: string | null;
  name: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  firstAt: string;        // oldest row in this session
  lastActivityAt: string; // newest ANY row in this session
  offlineAt: string | null; // newest offline marker in this session
  visitCount: number;     // real page views in this session
  isOnline: boolean;
}

// If a visitor has no activity for longer than this, the next ping is
// treated as a brand-new session (even if their browser session_id is the
// same). Covers the case where someone keeps the tab open all day — a
// lunch break or overnight gap is still "they went offline and came back".
const SESSION_GAP_MS = 30 * 60_000; // 30 minutes

function buildVisitorRows(visits: Visit[]): VisitorRow[] {
  const now = Date.now();

  // Group all rows by visitor first, then split each visitor's rows into
  // sessions by walking chronologically and starting a NEW session whenever:
  //   - we just saw an "offline" marker, OR
  //   - the gap since the last activity exceeds SESSION_GAP_MS.
  const byVisitor = new Map<string, Visit[]>();
  for (const v of visits) {
    if (!v.visitor_id) continue;
    const arr = byVisitor.get(v.visitor_id) || [];
    arr.push(v);
    byVisitor.set(v.visitor_id, arr);
  }

  const byKey = new Map<string, VisitorRow>();
  for (const [visitorId, rows] of byVisitor.entries()) {
    // Chronological order (oldest first) so we can walk the timeline
    rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    let sessionIndex = 0;
    let prevRow: Visit | null = null;
    let currentKey = "";

    for (const v of rows) {
      let startNewSession = false;
      if (!prevRow) {
        startNewSession = true;
      } else {
        const gap = Date.parse(v.created_at) - Date.parse(prevRow.created_at);
        if (isOfflineRow(prevRow)) startNewSession = true;
        else if (gap > SESSION_GAP_MS) startNewSession = true;
      }
      if (startNewSession) {
        sessionIndex++;
        currentKey = `${visitorId}:s${sessionIndex}:${v.created_at}`;
      }
      prevRow = v;

      const cur = byKey.get(currentKey);
      if (!cur) {
        byKey.set(currentKey, {
          rowKey: currentKey,
          visitorId,
          sessionId: v.session_id,
          name: v.chat_name,
          ip: v.ip,
          city: v.city,
          country: v.country,
          device: v.device_type,
          browser: v.browser,
          os: v.os,
          firstAt: v.created_at,
          lastActivityAt: v.created_at,
          offlineAt: isOfflineRow(v) ? v.created_at : null,
          visitCount: isRealVisit(v) ? 1 : 0,
          isOnline: false,
        });
      } else {
        if (isRealVisit(v)) cur.visitCount++;
        if (v.created_at < cur.firstAt) cur.firstAt = v.created_at;
        if (v.created_at > cur.lastActivityAt) cur.lastActivityAt = v.created_at;
        if (!cur.name && v.chat_name) cur.name = v.chat_name;
        if (!cur.ip && v.ip) cur.ip = v.ip;
        if (!cur.city && v.city) cur.city = v.city;
        if (!cur.country && v.country) cur.country = v.country;
        if (!cur.device && v.device_type) cur.device = v.device_type;
        if (!cur.browser && v.browser) cur.browser = v.browser;
        if (!cur.os && v.os) cur.os = v.os;
        if (isOfflineRow(v) && (!cur.offlineAt || v.created_at > cur.offlineAt)) {
          cur.offlineAt = v.created_at;
        }
      }
    }
  }
  // Backfill identity across sessions: if an older session for the same
  // visitor already has a known name/IP, propagate it to anonymous sessions.
  const identityByVisitor = new Map<string, { name: string | null; ip: string | null; city: string | null; country: string | null; device: string | null; browser: string | null; os: string | null }>();
  const sessionsSortedOldFirst = Array.from(byKey.values()).sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  for (const row of sessionsSortedOldFirst) {
    const prev = identityByVisitor.get(row.visitorId);
    if (prev) {
      row.name    = row.name    || prev.name;
      row.ip      = row.ip      || prev.ip;
      row.city    = row.city    || prev.city;
      row.country = row.country || prev.country;
      row.device  = row.device  || prev.device;
      row.browser = row.browser || prev.browser;
      row.os      = row.os      || prev.os;
    }
    identityByVisitor.set(row.visitorId, {
      name: row.name, ip: row.ip, city: row.city, country: row.country,
      device: row.device, browser: row.browser, os: row.os,
    });
  }
  const byId = byKey; // rename so the rest of the function still compiles
  // Compute isOnline + clear stale offlineAt
  for (const row of byId.values()) {
    const activityMs = Date.parse(row.lastActivityAt);
    const offlineMs = row.offlineAt ? Date.parse(row.offlineAt) : -1;
    // If their newest activity isn't an offline marker and is < 45s old → online
    const latestIsOffline = offlineMs >= activityMs;
    row.isOnline = !latestIsOffline && (now - activityMs <= LIVE_FRESH_MS);
    // If any activity happened AFTER the offline marker, clear the offline
    if (row.offlineAt && activityMs > offlineMs) row.offlineAt = null;
  }
  // Sort: online first (newest activity on top), then everyone else by newest activity
  return Array.from(byId.values()).sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
  });
}

export function AdminDashboard({
  initialData,
  token,
}: {
  initialData: Payload;
  token: string;
}) {
  const [data, setData] = useState<Payload>(initialData);
  const [status, setStatus] = useState<"live" | "stale" | "error">("live");
  const [lastPingAt, setLastPingAt] = useState<number>(Date.now());
  const [, forceTick] = useState(0);
  const [isAdminDevice, setIsAdminDevice] = useState(false);

  // Admin-device toggle (localStorage flag read by VisitTracker)
  useEffect(() => {
    try { setIsAdminDevice(window.localStorage.getItem(ADMIN_DEVICE_KEY) === "1"); } catch {}
  }, []);
  const toggleAdminDevice = () => {
    try {
      const next = !isAdminDevice;
      if (next) window.localStorage.setItem(ADMIN_DEVICE_KEY, "1");
      else window.localStorage.removeItem(ADMIN_DEVICE_KEY);
      setIsAdminDevice(next);
    } catch {}
  };

  // Poll /api/admin/data every POLL_MS, with a URL cache-buster
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const r = await fetch(
          `/api/admin/data?token=${encodeURIComponent(token)}&_t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const p = (await r.json()) as Payload;
        if (cancelled) return;
        setData(p);
        setLastPingAt(Date.now());
        setStatus("live");
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [token]);

  // Re-render every 2s so "x seconds ago" ticks and online flips cleanly
  useEffect(() => {
    const id = window.setInterval(() => forceTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, []);

  // Mark connection as stale if we haven't pinged recently
  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - lastPingAt > POLL_MS * 4) setStatus("stale");
    }, 2000);
    return () => window.clearInterval(id);
  }, [lastPingAt]);

  const visitors = useMemo(() => buildVisitorRows(data.visits), [data.visits, lastPingAt]);
  const liveNow = visitors.filter((v) => v.isOnline);

  // Chat activity (per-name)
  const perName = useMemo(() => {
    const map = new Map<string, { name: string; count: number; first: string; last: string }>();
    for (const m of data.messages) {
      const name = (m.sender_name ?? "").trim();
      if (!name) continue;
      const cur = map.get(name);
      if (!cur) map.set(name, { name, count: 1, first: m.created_at, last: m.created_at });
      else {
        cur.count++;
        if (m.created_at < cur.first) cur.first = m.created_at;
        if (m.created_at > cur.last) cur.last = m.created_at;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [data.messages]);

  return (
    <div className="mx-auto max-w-[1200px] p-4 sm:p-6">
      <style>{`
        @keyframes admin-live-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(1.4); }
        }
        .admin-live-dot { animation: admin-live-dot 1.5s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <header className="mb-5 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div>
          <h1 className="text-lg font-semibold">SN Desk — Admin</h1>
          <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">
            Live tracker for everyone who opens the SN Desk link. Auto-refreshes every {POLL_MS / 1000}s.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10.5px]">
          <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                status === "live" ? "bg-success admin-live-dot" :
                status === "stale" ? "bg-warning" : "bg-danger"
              }`}
            />
            <span className="uppercase tracking-wider">{status}</span>
          </span>
          <button
            onClick={toggleAdminDevice}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              isAdminDevice
                ? "bg-success/20 text-success"
                : "bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
            title={isAdminDevice
              ? "This device is marked as admin — its visits are NOT tracked. Click to un-mark."
              : "Mark this device as admin so its visits stop appearing in Recent Visitors."}
          >
            {isAdminDevice ? "✓ Admin device" : "Mark as admin device"}
          </button>
        </div>
      </header>

      {/* Summary line */}
      <section className="mb-4 grid grid-cols-3 gap-2">
        <SummaryCard label="Online now" value={liveNow.length} accent={liveNow.length > 0} />
        <SummaryCard label="Sessions" value={visitors.length} />
        <SummaryCard label="Chat messages" value={data.messages.length} />
      </section>

      {/* THE main table — all visitors in one place */}
      <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Recent Visitors ({visitors.length} session{visitors.length === 1 ? "" : "s"})
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            Online = active within last {LIVE_FRESH_MS / 1000}s
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">IP</th>
                <th className="px-2 py-2 text-left">Location</th>
                <th className="px-2 py-2 text-left">Device</th>
                <th className="px-2 py-2 text-left">Browser</th>
                <th className="px-2 py-2 text-left">OS</th>
                <th className="px-2 py-2 text-right">Visits</th>
                <th className="px-2 py-2 text-left">First seen</th>
                <th className="px-2 py-2 text-left">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visitors.map((v) => (
                <tr key={v.rowKey} className="border-t border-[var(--line)] hover:bg-[var(--surface-2)]">
                  <td className="px-2 py-1.5 font-medium">
                    {v.isOnline && (
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success admin-live-dot align-middle" />
                    )}
                    {v.name || <span className="text-[var(--text-muted)]">(anonymous)</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular text-[var(--text-muted)]">{v.ip || "—"}</td>
                  <td className="px-2 py-1.5">{v.city ? `${v.city}, ` : ""}{v.country || "—"}</td>
                  <td className="px-2 py-1.5">{v.device || "—"}</td>
                  <td className="px-2 py-1.5">{v.browser || "—"}</td>
                  <td className="px-2 py-1.5">{v.os || "—"}</td>
                  <td className="px-2 py-1.5 tabular text-right">{v.visitCount}</td>
                  <td className="px-2 py-1.5 tabular">{fmtWhen(v.firstAt)}</td>
                  <td className="px-2 py-1.5 tabular">
                    {v.isOnline ? (
                      <span className="font-medium text-success">
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success admin-live-dot align-middle" />
                        Online now
                      </span>
                    ) : v.offlineAt ? (
                      <>
                        {fmtWhen(v.offlineAt)}
                        <span className="text-[9.5px] text-[var(--text-muted)]"> (went offline {relSince(v.offlineAt)})</span>
                      </>
                    ) : (
                      <>
                        {fmtWhen(v.lastActivityAt)}
                        <span className="text-[9.5px] text-[var(--text-muted)]"> ({relSince(v.lastActivityAt)})</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {visitors.length === 0 && (
                <tr><td colSpan={9} className="px-2 py-6 text-center text-[var(--text-muted)]">No visitors yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Chat activity */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
        <header className="border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
          Chat activity — messages per registered name
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-right">Messages</th>
                <th className="px-2 py-2 text-left">First message</th>
                <th className="px-2 py-2 text-left">Last message</th>
              </tr>
            </thead>
            <tbody>
              {perName.map((u) => (
                <tr key={u.name} className="border-t border-[var(--line)]">
                  <td className="px-2 py-1.5 font-medium">{u.name}</td>
                  <td className="px-2 py-1.5 tabular text-right">{u.count}</td>
                  <td className="px-2 py-1.5 tabular">{fmtWhen(u.first)}</td>
                  <td className="px-2 py-1.5 tabular">
                    {fmtWhen(u.last)} <span className="text-[9.5px] text-[var(--text-muted)]">({relSince(u.last)})</span>
                  </td>
                </tr>
              ))}
              {perName.length === 0 && (
                <tr><td colSpan={4} className="px-2 py-6 text-center text-[var(--text-muted)]">No chat messages yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-4 text-center text-[10px] text-[var(--text-muted)]">
        Updated {relSince(new Date(lastPingAt).toISOString())} · generatedAt {data.generatedAt}
      </footer>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-0.5 text-[22px] font-semibold tabular ${accent ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}
