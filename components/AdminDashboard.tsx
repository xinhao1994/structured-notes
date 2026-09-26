"use client";

// Live admin dashboard — polls /api/admin/data every 3s. New visits and
// new visitor rows flash green briefly when they first appear. A "LIVE"
// indicator in the header pulses whenever a fresh fetch lands.

import { useEffect, useMemo, useRef, useState } from "react";

interface Visit {
  id: string;
  visitor_id: string | null;
  session_id: string | null;
  chat_name: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  user_agent: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  path: string | null;
  referrer: string | null;
  created_at: string;
}

interface ChatMsg {
  sender_name: string;
  created_at: string;
}

interface Payload {
  visits: Visit[];
  messages: ChatMsg[];
  generatedAt: string;
}

const POLL_MS = 3000;
const NEW_FLASH_MS = 6000;

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
  const [tick, setTick] = useState(0); // re-render for "relSince" every 15s
  const seenIdsRef = useRef<Set<string>>(new Set(initialData.visits.map((v) => v.id)));
  const seenVisitorsRef = useRef<Set<string>>(new Set(
    initialData.visits.map((v) => v.visitor_id).filter((x): x is string => !!x)
  ));
  const [newVisitIds, setNewVisitIds] = useState<Set<string>>(new Set());
  const [newVisitorIds, setNewVisitorIds] = useState<Set<string>>(new Set());

  // Polling loop
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const r = await fetch(`/api/admin/data?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const p = (await r.json()) as Payload;
        if (cancelled) return;

        // Detect new visits (ids we haven't seen before)
        const freshVisitIds: string[] = [];
        for (const v of p.visits) {
          if (!seenIdsRef.current.has(v.id)) freshVisitIds.push(v.id);
        }
        // Detect new visitors (visitor_ids we haven't seen before)
        const freshVisitorIds: string[] = [];
        for (const v of p.visits) {
          if (v.visitor_id && !seenVisitorsRef.current.has(v.visitor_id)) {
            freshVisitorIds.push(v.visitor_id);
          }
        }

        if (freshVisitIds.length > 0) {
          setNewVisitIds((prev) => {
            const next = new Set(prev);
            freshVisitIds.forEach((id) => next.add(id));
            return next;
          });
          freshVisitIds.forEach((id) => seenIdsRef.current.add(id));
          // Auto-clear flash after NEW_FLASH_MS
          window.setTimeout(() => {
            setNewVisitIds((prev) => {
              const next = new Set(prev);
              freshVisitIds.forEach((id) => next.delete(id));
              return next;
            });
          }, NEW_FLASH_MS);
        }
        if (freshVisitorIds.length > 0) {
          setNewVisitorIds((prev) => {
            const next = new Set(prev);
            freshVisitorIds.forEach((vid) => next.add(vid));
            return next;
          });
          freshVisitorIds.forEach((vid) => seenVisitorsRef.current.add(vid));
          window.setTimeout(() => {
            setNewVisitorIds((prev) => {
              const next = new Set(prev);
              freshVisitorIds.forEach((vid) => next.delete(vid));
              return next;
            });
          }, NEW_FLASH_MS);
        }

        setData(p);
        setLastPingAt(Date.now());
        setStatus("live");
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    };

    // First poll fires shortly after mount to catch anything that came in
    // between server-render and hydration
    timer = window.setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [token]);

  // Force a re-render every 15s so the "relSince" labels update
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { void tick; }, [tick]);

  // Mark connection as stale if we haven't pinged in > 3× poll interval
  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - lastPingAt > POLL_MS * 3) setStatus("stale");
    }, 2000);
    return () => window.clearInterval(id);
  }, [lastPingAt]);

  // ── Derive display stats ──
  const { visits, messages } = data;
  const now = Date.now();

  const perNameMap = new Map<string, { name: string; count: number; first: string; last: string }>();
  for (const m of messages) {
    const key = (m.sender_name ?? "").trim();
    if (!key) continue;
    const cur = perNameMap.get(key);
    if (!cur) perNameMap.set(key, { name: key, count: 1, first: m.created_at, last: m.created_at });
    else {
      cur.count++;
      if (m.created_at < cur.first) cur.first = m.created_at;
      if (m.created_at > cur.last) cur.last = m.created_at;
    }
  }
  const perName = Array.from(perNameMap.values()).sort((a, b) => b.count - a.count);
  const nameActive24h = perName.filter((u) => Date.parse(u.last) > now - 86400_000).length;
  const nameActive7d = perName.filter((u) => Date.parse(u.last) > now - 7 * 86400_000).length;

  const uniqueVisitors = new Set(visits.map((v) => v.visitor_id).filter(Boolean)).size;
  const visits24h = visits.filter((v) => Date.parse(v.created_at) > now - 86400_000).length;
  const visits7d = visits.filter((v) => Date.parse(v.created_at) > now - 7 * 86400_000).length;

  const countryCount = new Map<string, number>();
  const deviceCount = new Map<string, number>();
  const browserCount = new Map<string, number>();
  const osCount = new Map<string, number>();
  const pathCount = new Map<string, number>();
  for (const v of visits) {
    if (v.country) countryCount.set(v.country, (countryCount.get(v.country) ?? 0) + 1);
    if (v.device_type) deviceCount.set(v.device_type, (deviceCount.get(v.device_type) ?? 0) + 1);
    if (v.browser) browserCount.set(v.browser, (browserCount.get(v.browser) ?? 0) + 1);
    if (v.os) osCount.set(v.os, (osCount.get(v.os) ?? 0) + 1);
    if (v.path) pathCount.set(v.path, (pathCount.get(v.path) ?? 0) + 1);
  }
  const topBy = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const perVisitor = useMemo(() => {
    const map = new Map<string, {
      visitorId: string;
      lastName: string | null;
      lastIp: string | null;
      lastCity: string | null;
      lastCountry: string | null;
      lastDevice: string | null;
      lastBrowser: string | null;
      lastOs: string | null;
      firstAt: string;
      lastAt: string;
      visitCount: number;
    }>();
    for (const v of visits) {
      if (!v.visitor_id) continue;
      const cur = map.get(v.visitor_id);
      if (!cur) {
        map.set(v.visitor_id, {
          visitorId: v.visitor_id,
          lastName: v.chat_name,
          lastIp: v.ip,
          lastCity: v.city,
          lastCountry: v.country,
          lastDevice: v.device_type,
          lastBrowser: v.browser,
          lastOs: v.os,
          firstAt: v.created_at,
          lastAt: v.created_at,
          visitCount: 1,
        });
      } else {
        cur.visitCount++;
        if (v.created_at < cur.firstAt) cur.firstAt = v.created_at;
        if (!cur.lastName && v.chat_name) cur.lastName = v.chat_name;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [visits]);

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      <style>{`
        @keyframes admin-row-flash {
          0%   { background: rgba(76, 175, 80, 0.35); }
          100% { background: transparent; }
        }
        .admin-new-row {
          animation: admin-row-flash 6s ease-out forwards;
        }
        @keyframes admin-live-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(1.4); }
        }
        .admin-live-dot { animation: admin-live-dot 1.5s ease-in-out infinite; }
      `}</style>

      <header className="mb-4 flex flex-col gap-1 border-b border-[var(--line)] pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg font-semibold">SN Desk — Admin</h1>
          <div className="flex items-center gap-3 text-[10.5px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  status === "live" ? "bg-success admin-live-dot" :
                  status === "stale" ? "bg-warning" : "bg-danger"
                }`}
              />
              <span className="uppercase tracking-wider">
                {status === "live" ? "LIVE" : status === "stale" ? "STALE" : "OFFLINE"}
              </span>
              <span>· polling every {POLL_MS / 1000}s</span>
            </span>
            <span>updated {relSince(new Date(lastPingAt).toISOString())}</span>
          </div>
        </div>
        <p className="text-[10.5px] text-[var(--text-muted)]">
          Every page view logs IP, device, browser, city (via Vercel edge), path and timestamp.
          New visits flash green. Refresh on their own — leave this tab open.
        </p>
      </header>

      {/* Summary cards */}
      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Total visits" value={visits.length} sublabel="last 500 shown" />
        <StatCard label="Unique visitors" value={uniqueVisitors} sublabel="by browser fingerprint" />
        <StatCard label="Visits 24h" value={visits24h} accent />
        <StatCard label="Visits 7d" value={visits7d} />
        <StatCard label="Unique names" value={perName.length} sublabel="in chat" />
        <StatCard label="Names active 7d" value={nameActive7d} sublabel={`${nameActive24h} in 24h`} />
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <BreakdownCard title="Countries" entries={topBy(countryCount)} />
        <BreakdownCard title="Devices" entries={topBy(deviceCount)} />
        <BreakdownCard title="Browsers" entries={topBy(browserCount)} />
        <BreakdownCard title="OS" entries={topBy(osCount)} />
        <BreakdownCard title="Top pages" entries={topBy(pathCount)} />
      </section>

      {/* Unique visitors */}
      <section className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
        <header className="border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
          Unique visitors ({perVisitor.length})
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
              {perVisitor.map((v) => (
                <tr key={v.visitorId}
                    className={`border-t border-[var(--line)] hover:bg-[var(--surface-2)] ${newVisitorIds.has(v.visitorId) ? "admin-new-row" : ""}`}>
                  <td className="px-2 py-1.5 font-medium">
                    {newVisitorIds.has(v.visitorId) && <span className="mr-1 text-success">🟢</span>}
                    {v.lastName || <span className="text-[var(--text-muted)]">(anonymous)</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular text-[var(--text-muted)]">{v.lastIp || "—"}</td>
                  <td className="px-2 py-1.5">{v.lastCity ? `${v.lastCity}, ` : ""}{v.lastCountry || "—"}</td>
                  <td className="px-2 py-1.5">{v.lastDevice || "—"}</td>
                  <td className="px-2 py-1.5">{v.lastBrowser || "—"}</td>
                  <td className="px-2 py-1.5">{v.lastOs || "—"}</td>
                  <td className="px-2 py-1.5 tabular text-right">{v.visitCount}</td>
                  <td className="px-2 py-1.5 tabular">{fmtWhen(v.firstAt)}</td>
                  <td className="px-2 py-1.5 tabular">
                    {fmtWhen(v.lastAt)} <span className="text-[9.5px] text-[var(--text-muted)]">({relSince(v.lastAt)})</span>
                  </td>
                </tr>
              ))}
              {perVisitor.length === 0 && (
                <tr><td colSpan={9} className="px-2 py-6 text-center text-[var(--text-muted)]">No visits recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent visits raw feed */}
      <section className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
        <header className="border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
          Recent visits ({visits.length})
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-2 py-2 text-left">Time</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">IP</th>
                <th className="px-2 py-2 text-left">Location</th>
                <th className="px-2 py-2 text-left">Device</th>
                <th className="px-2 py-2 text-left">Browser</th>
                <th className="px-2 py-2 text-left">OS</th>
                <th className="px-2 py-2 text-left">Path</th>
                <th className="px-2 py-2 text-left">Referrer</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id}
                    className={`border-t border-[var(--line)] hover:bg-[var(--surface-2)] ${newVisitIds.has(v.id) ? "admin-new-row" : ""}`}
                    title={v.user_agent ?? ""}>
                  <td className="px-2 py-1.5 tabular whitespace-nowrap">
                    {newVisitIds.has(v.id) && <span className="mr-1 text-success">🟢</span>}
                    {fmtWhen(v.created_at)}
                  </td>
                  <td className="px-2 py-1.5 font-medium">{v.chat_name || <span className="text-[var(--text-muted)]">—</span>}</td>
                  <td className="px-2 py-1.5 tabular text-[var(--text-muted)]">{v.ip || "—"}</td>
                  <td className="px-2 py-1.5">{v.city ? `${v.city}, ` : ""}{v.country || "—"}</td>
                  <td className="px-2 py-1.5">{v.device_type || "—"}</td>
                  <td className="px-2 py-1.5">{v.browser || "—"}</td>
                  <td className="px-2 py-1.5">{v.os || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-[10.5px]">{v.path || "—"}</td>
                  <td className="px-2 py-1.5 text-[10.5px] text-[var(--text-muted)] max-w-[220px] truncate">{v.referrer || "direct"}</td>
                </tr>
              ))}
              {visits.length === 0 && (
                <tr><td colSpan={9} className="px-2 py-6 text-center text-[var(--text-muted)]">No visits yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
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
    </div>
  );
}

function StatCard({ label, value, sublabel, accent }: { label: string; value: string | number; sublabel?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-0.5 text-[22px] font-semibold tabular ${accent ? "text-accent" : ""}`}>{value}</div>
      {sublabel && <div className="text-[9.5px] text-[var(--text-muted)]">{sublabel}</div>}
    </div>
  );
}

function BreakdownCard({ title, entries }: { title: string; entries: [string, number][] }) {
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{title}</div>
      {entries.length === 0 ? (
        <div className="text-[11px] text-[var(--text-muted)]">no data</div>
      ) : (
        <ul className="space-y-0.5">
          {entries.map(([k, n]) => (
            <li key={k} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate">{k}</span>
              <span className="tabular text-[var(--text-muted)]">{n} · {Math.round((n / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
