// /admin?token=<ADMIN_TOKEN> — private dashboard. Isolated layout (no
// SN Desk nav). Initial data fetched server-side via raw Supabase REST to
// bypass any JS SDK caching. Client polls /api/admin/data every 2 seconds.

import { AdminDashboard } from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const VISIT_COLS = [
  "id", "visitor_id", "session_id", "chat_name",
  "ip", "country", "city", "region",
  "device_type", "browser", "os",
  "path", "referrer", "created_at",
].join(",");

async function supaFetch(path: string): Promise<any[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Cache-Control": "no-cache, no-store",
      },
      cache: "no-store",
    });
    if (!r.ok) return [];
    return r.json();
  } catch {
    return [];
  }
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

  const [visits, messages] = await Promise.all([
    supaFetch(`page_visits?select=${encodeURIComponent(VISIT_COLS)}&order=created_at.desc&limit=5000`),
    supaFetch(`chat_messages?select=sender_name,created_at&order=created_at.asc&limit=50000`),
  ]);

  return (
    <AdminDashboard
      initialData={{
        visits,
        messages,
        generatedAt: new Date().toISOString(),
      }}
      token={token}
    />
  );
}
