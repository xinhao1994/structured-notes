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

