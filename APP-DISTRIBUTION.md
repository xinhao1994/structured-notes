# Turning this into a real app on your phone

Three questions, honest answers up front:

| Question | Answer |
| --- | --- |
| Can I make this a real app (not just a website)? | **Yes** |
| Will updates auto-reflect when I `git push`? | **Yes** — see "why" below |
| Free? | **Android: yes, fully free.** **iOS: free only as PWA**, or $99/year for App Store |

The trick is that what you actually want is a **Trusted Web Activity** (TWA) on Android — a tiny native shell that opens your existing Vercel website inside a Chrome view, but to the user it looks and feels like any other installed app (own icon, own task-switcher entry, fullscreen with no browser bar, OS-level push notifications).

Because the shell just opens your live website, **every Vercel deploy is instantly live in the app**. You commit and push — your phone's app shows the new version the next time you open it. No app-store re-review, no rebuild.

---

## Option A — Android (free, recommended)

### Using PWABuilder (Microsoft) — easiest

1. Push this commit to GitHub. Vercel auto-deploys. Your live URL is `https://structured-notes-e421.vercel.app`.

2. Go to **https://www.pwabuilder.com** in any browser.

3. Paste your Vercel URL → click **Start**. It analyses the site's manifest + service worker. You should see all green ticks (we have valid `manifest.webmanifest`, service worker, and the icons I just generated at `/icons/icon-192.png` and `/icons/icon-512.png`).

4. Click **Package for stores** → **Android**.

5. On the form:
   - Package ID: `com.aiden.structurednotes` (or anything reverse-domain-style)
   - App name: `Structured Notes`
   - Start URL: `/`
   - Display mode: **standalone**
   - Click **Generate**.

6. Download the ZIP. It contains:
   - `app-release-signed.apk` (the actual app you install on your phone)
   - `app-release-bundle.aab` (only needed if you ever publish to Play Store)
   - A signing key (keep this safe — needed for future updates)
   - `assetlinks.json` (see step 8 below — important for hiding the URL bar)

7. **Install on your phone:**
   - Transfer the `.apk` to your phone (email, WhatsApp Web, AirDroid, USB cable, anything).
   - On the phone, open the file. Android will warn "Install from unknown sources" — go to Settings, allow installation from your file manager, install.
   - You now have an app icon called "Structured Notes" on your home screen. Tap → opens fullscreen, no browser chrome.

8. **Hide the address bar on first launch (one-time setup):**
   - In the ZIP, find `assetlinks.json`.
   - Copy that file to `public/.well-known/assetlinks.json` in this repo.
   - Push. After redeploy, the app will trust your domain and no longer briefly show a URL bar.

9. **Done.** Future flow: edit code → push to GitHub → Vercel deploys → next time you open the app it's the new version. **No app rebuild needed.**

### Optional: publish to Google Play

If you ever want it on Play Store (so friends/colleagues can install without sideloading):
- Pay $25 one-time Play Console fee
- Upload the `.aab` from PWABuilder
- Review takes 1–7 days first time, ~24 hours thereafter

You don't need this for personal use.

---

## Option B — iOS (mostly not free)

Apple's rules are stricter. Realistic free options are limited:

### B1 — PWA install (free, what you've been doing)
- On the iPhone, open the URL in **Safari** (must be Safari, not Chrome).
- Share button → **Add to Home Screen**.
- It gets an icon, launches fullscreen, supports push notifications (iOS 16.4+).
- This is what we already support. Visually 95% of "real app".

### B2 — Apple Developer account + App Store ($99/year)
- Sign up at developer.apple.com for $99/year (~MYR 470/year).
- Use **Capacitor** or **PWABuilder iOS package** to wrap the web app as an Xcode project.
- Build in Xcode → upload to App Store Connect → submit.
- App Store review takes 1–7 days first time.
- Updates: you still need to **rebuild + upload + wait for review** every time you want the wrapper itself updated, BUT the web content loads from your site so day-to-day Vercel pushes still auto-reflect.

### B3 — TestFlight only ($99/year but no public review)
- Same dev account, but you only install via TestFlight on your own phone (no public listing).
- Easier — no full App Store review, just TestFlight beta review which is usually <24 hours.

### B4 — AltStore sideload (free, fiddly)
- AltStore is a third-party install method that uses your Apple ID's "free dev account".
- Apps must be re-signed every 7 days using AltServer running on your computer.
- Not recommended for a daily-use tool — you'll forget and the app will stop launching.

**My recommendation for iOS:** stick with **B1 (PWA install)** unless you're willing to pay the $99/year. The PWA already supports push, dark mode, fullscreen, and home-screen install — the only thing you give up vs. native is access to the App Store icon prestige.

---

## Why does the app auto-update?

The TWA (Android) and PWA (iOS) approach both load your **deployed website** inside the app's WebView. They don't bundle the JS/HTML/CSS into the .apk — they just point at your URL.

So when you:
1. Edit code locally
2. `git commit -m "..."`
3. `git push origin main`

Vercel detects the push and rebuilds in ~60 seconds. The next time your phone's app opens, it fetches the new HTML/CSS/JS from your Vercel URL. **No app rebuild, no app store upload, no review.**

The only time you need to rebuild the .apk is when you change:
- The app icon
- The app name
- The TWA shell version
- Push notification handling at the OS level (rare)

In practice, you might rebuild the .apk once a year, if that.

---

## Option C — Capacitor wrapper (advanced, both platforms)

If you ever want truly native features (Face ID directly, iOS widgets, deeper notification integration), use **Capacitor** (Ionic's wrapper):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Structured Notes" com.aiden.structurednotes
npx cap add android
npx cap add ios
```

Configure it to load from your remote URL (so updates still auto-reflect):

```json
// capacitor.config.json
{
  "appId": "com.aiden.structurednotes",
  "appName": "Structured Notes",
  "server": {
    "url": "https://structured-notes-e421.vercel.app",
    "cleartext": false
  }
}
```

Then build via:
- **Android:** `npx cap open android` → Android Studio → Build → APK
- **iOS:** `npx cap open ios` → Xcode → Build (requires $99 dev account to install on phone)

This gives you more control but is more complex than PWABuilder for the same outcome.

---

## Bottom line

**For Aiden's situation (Malaysia, free, just want it on the phone):**

1. **Android:** Use PWABuilder → install APK directly. Free, looks/feels like a real app, auto-updates from your pushes. **This is the answer.**

2. **iOS:** Add to Home Screen via Safari. Free, supports push notifications. As "real" as Apple lets you be without paying.

3. Every code change you push to GitHub auto-reflects in both. **No app rebuilds for content updates.**

You can do step 1 right now once this commit is deployed — visit pwabuilder.com, paste your URL, download, install. ~5 minutes total.
