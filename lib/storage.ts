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

/** Patch fields on a saved tranche. Used by the inline tranche-code editor. */
export function updateTrancheFields(id: string, updates: Partial<Tranche>): void {
  savePocket(
    listPocket().map((e) =>
      e.id === id ? { ...e, tranche: { ...e.tranche, ...updates } } : e
    )
  );
}
