// /admin?token=<ADMIN_TOKEN> — private live dashboard.
// Server component does the auth + initial data fetch, then hands off to
// the AdminDashboard client component which polls /api/admin/data every
// 3 seconds and flashes new visits green as they arrive.

import { getSupabaseAdmin } from "@/lib/supabase";
import { AdminDashboard } from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

  // Initial data fetch — server-side, so the page renders instantly with real
  // data on first paint. The client then takes over with 3-second polling.
  const [visitsRes, msgsRes] = await Promise.all([
    supa.from("page_visits").select("*").order("created_at", { ascending: false }).limit(500),
    supa.from("chat_messages").select("sender_name, created_at").order("created_at", { ascending: true }).limit(50_000),
  ]);

  return (
    <AdminDashboard
      initialData={{
        visits: visitsRes.data ?? [],
        messages: msgsRes.data ?? [],
        generatedAt: new Date().toISOString(),
      }}
      token={token}
    />
  );
}
