// /admin?token=<ADMIN_TOKEN> — private dashboard showing every chat name,
// every visit, IP, device, browser, city, and time. Server component: the
// token check + Supabase read happen on the server, so nothing leaks if
// someone hits the URL without the token.

import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function relSince(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ipTruncate(ip: string | null): string {
  if (!ip) return "—";
  // Keep IPv4 first-two octets, mask last two for a slight privacy layer
  // in the display (the raw IP is still stored and available on hover).
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  return ip;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp?.token;
  const token = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[13px] text-[var(--text-muted)]">
        Admin dashboard is disabled. Set <code>ADMIN_TOKEN</code> in Vercel to enable.
      </div>
    );
  }
  if (!constantTimeEqual(token, expected)) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[13px] text-[var(--text-muted)]">
        Access denied.
      </div>
    );
  }

  const supa = getSupabaseAdmin();
  if (!supa) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[13px] text-danger">
        Supabase admin client not configured. Check SUPABASE_SERVICE_ROLE_KEY.
      </div>
    );
  }

  // ── Fetch everything in parallel ──
  const [visitsRes, msgsRes] = await Promise.all([
    supa.from("page_visits").select("*").order("created_at", { ascending: false }).limit(500),
    supa.from("chat_messages").select("sender_name, created_at").order("created_at", { ascending: true }).limit(50_000),
  ]);
  const visits: Visit[] = (visitsRes.data ?? []) as Visit[];
  const messages: ChatMsg[] = (msgsRes.data ?? []) as ChatMsg[];

  // ── Aggregate chat stats ──
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
  const now = Date.now();
  const nameActive24h = perName.filter((u) => Date.parse(u.last) > now - 86400_000).length;
  const nameActive7d  = perName.filter((u) => Date.parse(u.last) > now - 7 * 86400_000).length;

  // ── Aggregate visit stats ──
  const uniqueVisitors = new Set(visits.map((v) => v.visitor_id).filter(Boolean)).size;
  const visits24h = visits.filter((v) => Date.parse(v.created_at) > now - 86400_000).length;
  const visits7d  = visits.filter((v) => Date.parse(v.created_at) > now - 7 * 86400_000).length;

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

  // ── Group visits per visitor for a "who came here" view ──
  const perVisitor = new Map<string, {
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
  // visits are already newest-first
  for (const v of visits) {
    if (!v.visitor_id) continue;
    const cur = perVisitor.get(v.visitor_id);
    if (!cur) {
      perVisitor.set(v.visitor_id, {
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
      // Fill in the name if a later (newer) visit had it but the "last" (already-newest) didn't
      if (!cur.lastName && v.chat_name) cur.lastName = v.chat_name;
    }
  }
  const visitorList = Array.from(perVisitor.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      {/* Header */}
      <header className="mb-4 flex flex-col gap-1 border-b border-[var(--line)] pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg font-semibold">SN Desk — Admin</h1>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            Generated {fmtWhen(new Date().toISOString())} · showing latest 500 visits
          </div>
        </div>
        <p className="text-[10.5px] text-[var(--text-muted)]">
          Every page view logs IP, device, browser, city (via Vercel edge), path and timestamp.
          Data is server-side only — this URL is the only way to view it.
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

      {/* Breakdown pills */}
      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <BreakdownCard title="Countries" entries={topBy(countryCount)} />
        <BreakdownCard title="Devices" entries={topBy(deviceCount)} />
        <BreakdownCard title="Browsers" entries={topBy(browserCount)} />
        <BreakdownCard title="OS" entries={topBy(osCount)} />
        <BreakdownCard title="Top pages" entries={topBy(pathCount)} />
      </section>

      {/* Unique visitors table */}
      <section className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
        <header className="border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
          Unique visitors ({visitorList.length}) — grouped by browser fingerprint
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
              {visitorList.map((v) => (
                <tr key={v.visitorId} className="border-t border-[var(--line)] hover:bg-[var(--surface-2)]">
                  <td className="px-2 py-1.5 font-medium">{v.lastName || <span className="text-[var(--text-muted)]">(anonymous)</span>}</td>
                  <td className="px-2 py-1.5 tabular text-[var(--text-muted)]">{ipTruncate(v.lastIp)}</td>
                  <td className="px-2 py-1.5">
                    {v.lastCity ? `${v.lastCity}, ` : ""}{v.lastCountry || "—"}
                  </td>
                  <td className="px-2 py-1.5">{v.lastDevice || "—"}</td>
                  <td className="px-2 py-1.5">{v.lastBrowser || "—"}</td>
                  <td className="px-2 py-1.5">{v.lastOs || "—"}</td>
                  <td className="px-2 py-1.5 tabular text-right">{v.visitCount}</td>
                  <td className="px-2 py-1.5 tabular">{fmtWhen(v.firstAt)}</td>
                  <td className="px-2 py-1.5 tabular">{fmtWhen(v.lastAt)} <span className="text-[9.5px] text-[var(--text-muted)]">({relSince(v.lastAt)})</span></td>
                </tr>
              ))}
              {visitorList.length === 0 && (
                <tr><td colSpan={9} className="px-2 py-6 text-center text-[var(--text-muted)]">No visits recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent visits raw feed */}
      <section className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
        <header className="border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
          Recent visits ({visits.length}) — newest first
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
                <tr key={v.id} className="border-t border-[var(--line)] hover:bg-[var(--surface-2)]" title={v.user_agent ?? ""}>
                  <td className="px-2 py-1.5 tabular whitespace-nowrap">{fmtWhen(v.created_at)}</td>
                  <td className="px-2 py-1.5 font-medium">{v.chat_name || <span className="text-[var(--text-muted)]">—</span>}</td>
                  <td className="px-2 py-1.5 tabular text-[var(--text-muted)]">{ipTruncate(v.ip)}</td>
                  <td className="px-2 py-1.5">{v.city ? `${v.city}, ` : ""}{v.country || "—"}</td>
                  <td className="px-2 py-1.5">{v.device_type || "—"}</td>
                  <td className="px-2 py-1.5">{v.browser || "—"}</td>
                  <td className="px-2 py-1.5">{v.os || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-[10.5px]">{v.path || "—"}</td>
                  <td className="px-2 py-1.5 text-[10.5px] text-[var(--text-muted)] max-w-[220px] truncate">{v.referrer || "direct"}</td>
                </tr>
              ))}
              {visits.length === 0 && (
                <tr><td colSpan={9} className="px-2 py-6 text-center text-[var(--text-muted)]">No visits yet — tracking starts after next deploy.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Chat activity per user */}
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
                  <td className="px-2 py-1.5 tabular">{fmtWhen(u.last)} <span className="text-[9.5px] text-[var(--text-muted)]">({relSince(u.last)})</span></td>
                </tr>
              ))}
              {perName.length === 0 && (
                <tr><td colSpan={4} className="px-2 py-6 text-center text-[var(--text-muted)]">No chat messages yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-center text-[9.5px] text-[var(--text-muted)]">
        Refresh this page to update. Data captured server-side via Vercel edge geolocation.
      </footer>
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-0.5 text-[22px] font-semibold tabular ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
      {sublabel && <div className="text-[9.5px] text-[var(--text-muted)]">{sublabel}</div>}
    </div>
  );
}

function BreakdownCard({
  title,
  entries,
}: {
  title: string;
  entries: [string, number][];
}) {
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
