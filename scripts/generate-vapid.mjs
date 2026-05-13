// One-shot script to generate a VAPID keypair for Web Push.
//
// Usage (after `npm install` has run locally):
//   node scripts/generate-vapid.mjs
//
// Paste the printed keys into your Vercel project's environment variables
// (Production + Preview + Development).

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log("");
console.log("Copy these into your Vercel env vars:");
console.log("");
console.log("VAPID_PUBLIC_KEY               =", publicKey);
console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY   =", publicKey);
console.log("VAPID_PRIVATE_KEY              =", privateKey);
console.log("VAPID_SUBJECT                  = mailto:you@example.com");
console.log("");
console.log("Don't commit these. The private key is a secret.");
