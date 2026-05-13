// GET /api/setup-status
//
// Returns which push-notification env vars are configured (without leaking
// the secret values). Lets the user sanity-check their Vercel env vars are
// set correctly before trying to subscribe.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    VAPID_PUBLIC_KEY: !!process.env.VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: !!process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: !!process.env.VAPID_SUBJECT,
    CRON_SECRET: !!process.env.CRON_SECRET,
  };
  const missing = Object.entries(env).filter(([_, v]) => !v).map(([k]) => k);
  return NextResponse.json({
    ready: missing.length === 0,
    configured: env,
    missing,
    nextStep: missing.length === 0
      ? "All env vars set. Go to Pocket and tap 'Enable 9am morning alerts'."
      : "Add the missing env vars in Vercel → Settings → Environment Variables, then redeploy.",
  });
}
