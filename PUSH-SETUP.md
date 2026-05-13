# Daily 9am Push Notifications — Setup

VAPID keys + cron secret are **pre-generated** below. You only need to:
1. Create a Supabase project (free, ~3 minutes).
2. Paste **8 environment variables** into Vercel.
3. Push and install the PWA on your phone.

All code is already in this commit. After the env vars are set and you redeploy, hitting `/api/setup-status` will tell you whether everything is ready.

---

## Step 1 — Create the Supabase project

1. Go to **https://supabase.com** and sign up (or log in).
2. **New Project** → name it `structured-notes-push` → pick the closest region (Singapore is closest to KL).
3. Wait ~2 minutes for provisioning.
4. Once ready, go to **SQL Editor** → **New query**.
5. Open `db/push-subscriptions.sql` in this repo, copy the entire contents, paste into the SQL editor, and click **Run**.
6. Now grab the credentials from **Project Settings → API**:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **service_role secret** under "Project API keys" (the long `eyJhbGciOi...` string — keep it secret, it bypasses RLS)

---

## Step 2 — Set Vercel environment variables

Open your project in Vercel → **Settings → Environment Variables**. For each row below, check **Production**, **Preview**, **Development** before saving.

| Variable name | Value to paste |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | (from Supabase Step 1.6 — your Project URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase Step 1.6 — your service_role key) |
| `VAPID_PUBLIC_KEY` | `BFcHsg7xZ-jnngGO1hDbg4Yb8-eaWPxkUY5RQp2wcCv5_llKwqRBHcTXLB0HlaQr0Wqu_D9xboJvcMiPbjl7chg` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `BFcHsg7xZ-jnngGO1hDbg4Yb8-eaWPxkUY5RQp2wcCv5_llKwqRBHcTXLB0HlaQr0Wqu_D9xboJvcMiPbjl7chg` |
| `VAPID_PRIVATE_KEY` | `tUFnMMvGaVoAvt-78MHc_X88Jf9pAwhpXw7uK8v6Fx8` |
| `VAPID_SUBJECT` | `mailto:chyi0728016@gmail.com` |
| `CRON_SECRET` | `f7e0d761141078908ab1b83cfdd3dcee4ce539a8c02d528a288026fdb007311c` |

> **Heads-up about the keys above:** these were generated for this commit. Since they appear in this file (committed to git), if you want maximum security, generate fresh ones with `node scripts/generate-vapid.mjs` after `npm install` and paste those instead. For a personal-use RM tool, the pre-generated ones are fine.

After all 7 rows are saved, hit **Deployments** → click the latest one → **Redeploy** (Vercel needs a fresh build to pick up env vars).

---

## Step 3 — Verify the setup

Once the redeploy finishes (~1 minute), open in any browser:

```
https://<your-vercel-domain>/api/setup-status
```

You should see:

```json
{
  "ready": true,
  "configured": { ...all true... },
  "missing": [],
  "nextStep": "All env vars set. Go to Pocket and tap 'Enable 9am morning alerts'."
}
```

If `ready: false`, the `missing` array names the env var that's not set.

---

## Step 4 — Subscribe your phone

1. On your phone, open the deployed app in **Safari (iOS)** or **Chrome (Android)**.
2. **Install to home screen.** Push notifications on iOS only work when the PWA is installed:
   - **Safari iOS:** Share button → "Add to Home Screen" → Add.
   - **Chrome Android:** menu → "Install app".
3. Open the installed PWA from your home screen.
4. Go to **Pocket** tab.
5. Tap **Enable 9am morning alerts** (under the daily-obs section).
6. Accept the browser's notification prompt.

You should see the button flip to "Morning alerts on — tap to disable". Behind the scenes the device has POSTed its push subscription + your current Pocket to `/api/push/subscribe` and a row is now in Supabase.

---

## Step 5 — Test the cron manually (optional)

You can fire the daily check yourself any time to confirm it works:

```bash
curl -i "https://<your-vercel-domain>/api/cron/daily-obs-check" \
  -H "Authorization: Bearer f7e0d761141078908ab1b83cfdd3dcee4ce539a8c02d528a288026fdb007311c"
```

Expected response: `{"ok":true,"subscriptions":1,"sent":N,"skipped":M,"removed":0,"errors":0,"ranAt":...}`. If `sent ≥ 1` and your Pocket has an observation today (Malaysia date), your phone buzzes within seconds.

If you only see `skipped`, no Pocket tranche has an observation falling on today's Malaysia date — that's correct behaviour, the alert only fires on those days.

---

## What happens automatically from here

- **Vercel Cron** (configured in `vercel.json`) calls `/api/cron/daily-obs-check` every day at **01:00 UTC = 09:00 Malaysia**.
- It reads every push subscription, computes today's date in each subscription's timezone (defaults to Asia/Kuala_Lumpur), checks every Pocket tranche's KO schedule for observations matching today, and fires a Web Push if any match.
- Every time you save / edit / pin / unpin / delete a tranche in Pocket, the local `savePocket()` auto-syncs the new state to Supabase via `/api/push/sync`. So the cron always has the latest version of your Pocket — no manual re-subscribe needed.
- Dead subscriptions (user uninstalled the PWA, browser revoked permission) auto-clean up: the cron deletes any row that returns 410/404 from the push provider.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Push API unsupported (iOS Safari requires Add to Home Screen first)" when tapping Enable | You're in regular Safari, not the installed PWA. Add to Home Screen, then open from there. |
| `/api/setup-status` shows `missing: ["SUPABASE_SERVICE_ROLE_KEY"]` | You forgot to redeploy after adding the env var, or it's set to a wrong value. |
| Cron returns 401 | `CRON_SECRET` env var doesn't match the one in the curl test command. |
| `subscriptions: 0` from cron | No device has tapped "Enable" yet, or the row was deleted (browser revoked). |
| Notification doesn't appear despite `sent: 1` | iOS background-push reliability is OS-controlled — if the phone is offline at 9am the push queues and delivers when it's back online (within the 8-hour TTL). |

## Privacy

Each row in `push_subscriptions` is keyed by an unguessable Web Push endpoint URL (issued by the push provider, not by us). There's no user account, no email or name on the server, and no identifier beyond the endpoint string itself. Tapping **Disable** in Pocket deletes the row immediately.
