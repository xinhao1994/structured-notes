"use client";
// usePriceTick — tracks whether the latest price moved up or down vs the
// previous value, and returns a "tick" direction that auto-clears after a
// short window so the UI can flash green/red briefly.
//
// Used by <TickingPrice> in the Desk product table and the Dashboard
// underlying cards so every poll cycle visibly registers as a tick.

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 700;

export type TickDir = "up" | "down" | null;

export function usePriceTick(price: number | null | undefined): TickDir {
  const prev = useRef<number | null | undefined>(price);
  const [dir, setDir] = useState<TickDir>(null);

  useEffect(() => {
    if (price == null || prev.current == null) {
      prev.current = price;
      return;
    }
    if (price === prev.current) return;
    const nextDir: TickDir = price > prev.current ? "up" : "down";
    setDir(nextDir);
    prev.current = price;
    const id = setTimeout(() => setDir(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [price]);

  return dir;
}
