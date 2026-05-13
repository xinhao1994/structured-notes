// Pocket persistence — localStorage now, designed so it can be swapped for
// Supabase later by replacing the read/write functions. Schema is versioned
// so we can migrate when the shape changes.

"use client";
import type { Tranche } from "./types";

const KEY = "snd.pocket.v1";

export interface PocketEntry {
  id: string;          // tranche code + createdAt — stable identifier
  tranche: Tranche;
  pinned?: boolean;
  savedAt: string;
}

export function listPocket(): PocketEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PocketEntry[];
  } catch {
    return [];
  }
}

export function savePocket(list: PocketEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(list));
  // Fire-and-forget sync to the server when push is enabled. Lives in a
  // separate module so server code can import storage without dragging in
  // the push client. Wrapped in try so a failed sync never breaks a save.
  try {
    // Dynamic import — avoids pulling pushClient (and its `navigator` refs)
    // into the SSR bundle.
    import("./pushClient").then((m) => m.syncPocket(list).catch(() => {})).catch(() => {});
  } catch {}
}

export function upsertTranche(t: Tranche): PocketEntry {
  const id = `${t.trancheCode}-${t.createdAt}`;
  const list = listPocket();
  const idx = list.findIndex((e) => e.tranche.trancheCode === t.trancheCode);
  const entry: PocketEntry = { id, tranche: t, savedAt: new Date().toISOString() };
  if (idx >= 0) list[idx] = { ...list[idx], ...entry, id: list[idx].id };
  else list.unshift(entry);
  savePocket(list);
  return list[idx >= 0 ? idx : 0];
}

export function removePocket(id: string): void {
  savePocket(listPocket().filter((e) => e.id !== id));
}

export function togglePin(id: string): void {
  savePocket(
    listPocket().map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e))
  );
}


/** Patch fields on a saved tranche. Used by the inline tranche-code + notes editors. */
export function updateTrancheFields(id: string, updates: Partial<Tranche>): void {
  savePocket(
    listPocket().map((e) =>
      e.id === id ? { ...e, tranche: { ...e.tranche, ...updates } } : e
    )
  );
}

// ─── current-tranche persistence (raw paste) ────────────────────────────────
// We persist the raw text of the most-recently-parsed tranche so that
// navigating Desk → Pocket → Desk doesn't lose it, and so the Calculator
// page can default to it. Cleared only when the user parses a new one.
const CURRENT_KEY = "snd.current.parsedText.v1";

export function getCurrentParsedText(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(CURRENT_KEY); } catch { return null; }
}
export function setCurrentParsedText(text: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CURRENT_KEY, text); } catch {}
}

// ─── manual initial-fixing overrides ───────────────────────────────────────
// Lets the user type in an authoritative initial-fixing value when the
// historical-data API returns something they disagree with (e.g. after a
// stock split / spin-off, or when reference data they trust differs).
// Keyed by tranche code so overrides survive parse refreshes.
const OVERRIDE_KEY = "snd.fixingOverrides.v1";

export function getFixingOverrides(trancheCode: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(OVERRIDE_KEY) || "{}") as Record<string, Record<string, number>>;
    return all[trancheCode] || {};
  } catch { return {}; }
}

export function setFixingOverride(trancheCode: string, symbol: string, value: number | null): void {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(window.localStorage.getItem(OVERRIDE_KEY) || "{}") as Record<string, Record<string, number>>;
    if (!all[trancheCode]) all[trancheCode] = {};
    if (value == null) delete all[trancheCode][symbol];
    else all[trancheCode][symbol] = value;
    if (Object.keys(all[trancheCode]).length === 0) delete all[trancheCode];
    window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
  } catch {}
}

// ─── client calculator settings (persisted per tranche) ────────────────────
// Remembers the user's last currency + principal so navigating away and back
// doesn't reset their input. Keyed by tranche code so the calculator picks
// up where they left off for each tranche.
const CALC_KEY = "snd.calcSettings.v1";

export interface CalcSettings {
  trancheId?: string;
  currency?: string;
  principal?: number;
  /** Which observation # the tranche knocked out at (null = not yet KO'd). */
  knockedOutAt?: number | null;
  /** Index into the message-template carousel. */
  msgTemplateIdx?: number;
  /** The tranche code that the persisted currency/principal/KO state belong
   *  to. When the Calculator opens and the current tranche's code differs
   *  from this value, the calculator resets currency, principal, and KO
   *  observation to the new tranche's defaults instead of keeping stale
   *  values from a previous tranche. */
  forTrancheCode?: string;
}

export function getCalcSettings(): CalcSettings {
  if (typeof window === "undefined") return {};
  try {
    return (JSON.parse(window.localStorage.getItem(CALC_KEY) || "{}") || {}) as CalcSettings;
  } catch { return {}; }
}

export function setCalcSettings(patch: Partial<CalcSettings>): void {
  if (typeof window === "undefined") return;
  try {
    const cur = getCalcSettings();
    window.localStorage.setItem(CALC_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}


// ─── per-tranche knock-out detection ───────────────────────────────────────
// Set by the Desk KOSchedule when it observes that the worst-of underlying was
// above the KO trigger on a past observation date. Read by the Calculator so
// its "Knocked out at obs #" dropdown defaults to the Desk-detected value
// (instead of forcing the user to scroll/select manually). User can still
// override via the dropdown — see CalcSettings.knockedOutAt above for that.
const KO_DETECTED_KEY = "snd.koDetected.v1";

export function getKnockedOutByTranche(trancheCode: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(window.localStorage.getItem(KO_DETECTED_KEY) || "{}") as Record<string, number>;
    return typeof all[trancheCode] === "number" ? all[trancheCode] : null;
  } catch { return null; }
}

export function setKnockedOutByTranche(trancheCode: string, n: number | null): void {
  if (typeof window === "undefined") return;
  try {
    const all = JSON.parse(window.localStorage.getItem(KO_DETECTED_KEY) || "{}") as Record<string, number>;
    if (n == null) delete all[trancheCode];
    else all[trancheCode] = n;
    window.localStorage.setItem(KO_DETECTED_KEY, JSON.stringify(all));
  } catch {}
}

