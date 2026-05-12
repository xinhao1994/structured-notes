"use client";
// Compute "was this tranche knocked out, and at which observation #?"
// using the OFFICIAL CLOSE on each past observation date — not the
// current live spot. Returns:
//   - detected:  obs # of the latest past observation where the
//                worst-of underlying's close was at or above the
//                KO trigger. Null when nothing has KO'd yet.
//   - pending:   true while historical closes are being fetched.
//
// Internally:
//   - Delegates the fetch to useObservationCloses (which caches
//     historical closes in localStorage permanently — they're
//     immutable).
//   - Persists the detected obs # to storage via setKnockedOutByTranche,
//     so the Calculator can default its "Knocked out at obs #" dropdown
//     to this value without having to recompute.
//   - Used by both Desk (KOSchedule) and Calculator. Whichever page
//     mounts first triggers the fetch; the other page reads from cache
//     and gets the answer instantly. This is the fix for the bug where
//     opening Calculator immediately after parsing didn't auto-pick
//     the observation # — previously the detection only ran inside
//     KOSchedule, so if the user never opened Desk after parsing the
//     calculator stayed on "— not yet —".

import { useEffect, useState } from "react";
import type { Tranche } from "../types";
import { koSchedule } from "../calc";
import { setKnockedOutByTranche, getKnockedOutByTranche } from "../storage";
import { useObservationCloses } from "./useObservationCloses";

export function useDetectedKO(tranche: Tranche | null): {
  detected: number | null;
  pending: boolean;
} {
  const { closes, pending } = useObservationCloses(tranche);

  // Seed from storage so the first render already reflects what we knew
  // last time. If detection later refines it, we update.
  const [detected, setDetected] = useState<number | null>(() =>
    tranche ? getKnockedOutByTranche(tranche.trancheCode) : null
  );

  // When the tranche changes, re-seed from storage immediately. This
  // matters when the user switches between tranches — without this,
  // `detected` would briefly hold the previous tranche's value.
  useEffect(() => {
    if (!tranche) { setDetected(null); return; }
    setDetected(getKnockedOutByTranche(tranche.trancheCode));
  }, [tranche?.trancheCode]);

  useEffect(() => {
    if (!tranche) return;
    if (pending) return;             // wait for historical closes
    const sched = koSchedule(tranche);
    const today = new Date().toISOString().slice(0, 10);
    let d: number | null = null;
    for (const o of sched) {
      if (o.date >= today) break;
      const obsData = closes[o.n];
      if (!obsData) continue;
      let worstCushion: number | null = null;
      let allResolved = true;
      for (const u of tranche.underlyings) {
        const koPx = o.koPriceBySymbol[u.symbol];
        const hist = obsData[u.symbol]?.close;
        if (koPx == null || hist == null) { allResolved = false; continue; }
        const cushion = ((hist - koPx) / koPx) * 100;
        if (worstCushion == null || cushion < worstCushion) worstCushion = cushion;
      }
      // Confirmed KO only when we have closes for ALL underlyings AND
      // the worst-of's close was at/above the KO trigger.
      if (allResolved && worstCushion != null && worstCushion >= 0) d = o.n;
    }
    setDetected(d);
    setKnockedOutByTranche(tranche.trancheCode, d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tranche?.trancheCode, pending, JSON.stringify(closes)]);

  return { detected, pending };
}
