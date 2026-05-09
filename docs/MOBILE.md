# Mobile packaging — iOS & Android

Two routes are supported:

1. **PWA install** — works today, no extra build, no app stores. Open the deployed URL on iOS Safari → Share → Add to Home Screen. On Android Chrome → "Install app".
2. **Capacitor wrappers** — wrap the same Next.js build into native iOS / Android shells. Use this when you need TestFlight / Play Store distribution, native push, biometric login, or background tasks.

---

## Path A — PWA (zero extra work)

The repo already ships:

- `public/manifest.webmanifest` — installable manifest, theme colour, scope, icons.
- `public/sw.js` — app-shell cache + network-first for `/api/`, push handler.
- iOS-specific meta in `app/layout.tsx` (`apple-touch-icon`, status bar).

**Verify before launch:**

```bash
npm run build && npm start
# open chrome://inspect → Lighthouse → Progressive Web App → score should be ≥90
```

---

## Path B — Capacitor (App Store / Play Store)

Recommended because it reuses the same web codebase, the same APIs, and the same Tailwind UI.

### 1. Build a static export of the marketing chrome

The Next.js app uses a server route (`/api/prices`). Capacitor needs to point at a hosted backend, so:

- Deploy the Next.js app to Vercel (Path A above) — the production URL becomes the app's data backend.
- For the app shell itself, build a small `next export`-style wrapper that points web traffic at the deployed origin. Or, even simpler, run the Capacitor app in `server: { url: 'https://your-deployed-host' }` mode (see step 5).

### 2. Install Capacitor

```bash
npm i @capacitor/core @capacitor/cli
npm i @capacitor/ios @capacitor/android
npm i @capacitor/push-notifications @capacitor/status-bar @capacitor/splash-screen
npx cap init "SN Desk" com.yourbank.sndesk --web-dir=out
```

### 3. Add native projects

```bash
npx cap add ios
npx cap add android
```

### 4. `capacitor.config.ts`

```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourbank.sndesk',
  appName: 'SN Desk',
  webDir: 'out',
  server: {
    // Production: point at the deployed Next.js host so /api/prices works
    url: 'https://sn-desk.yourbank.internal',
    cleartext: false,
  },
  ios: { contentInset: 'always' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 600 },
    PushNotifications: { presentationOptions: ['alert', 'sound', 'badge'] },
  },
};
export default config;
```

### 5. Build

```bash
# iOS
npx cap open ios
# In Xcode: signing team, bundle id, push capability, then build/run on a device
# TestFlight upload: Product → Archive → Distribute App

# Android
npx cap open android
# Android Studio: signingConfigs, build → generate signed bundle (.aab) → Play Console
```

### 6. Push notifications

- iOS: enable Push capability in Xcode, upload APNs auth key to Firebase.
- Android: add `google-services.json` from Firebase to `android/app/`.
- Bridge web-push events: in your backend, when a KI/KO/coupon/maturity alert fires, call FCM (Android) and APNs (iOS) using the `push_subscriptions.platform = 'ios' | 'android'` rows.

### 7. Background price refresh

Add `@capacitor/background-runner` if you need price polling while the app is suspended. For most desk users, push is sufficient — the app simply pulls fresh on resume.

---

## Submission notes

| Store | Watch out for |
| --- | --- |
| App Store | Requires "What's New" notes; private deployment via TestFlight or B2B Volume Purchase Program for internal-only RM use. |
| Play Store | Closed testing track for internal-only; Play Console allows email-list distribution. |
| Both | If app shows live market quotes branded as a financial product, your compliance team likely needs a vendor disclosure for Polygon / Finnhub / Alpha Vantage in the app metadata. |

---

## Internal-only distribution (no app stores)

- iOS: Apple Business Manager + Custom Apps, or MDM-pushed.
- Android: side-load .apk via the bank MDM (Workspace ONE, Intune).
