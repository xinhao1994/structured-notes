"use client";

// SwipeNavigator — detects a horizontal finger flick on mobile and navigates
// between the bottom-nav tabs. Mounted once at the layout level so it works
// on every page.
//
// Behaviour:
//   - Swipe LEFT  → next tab  (Desk → Pocket → Calc → Analyze → Chat)
//   - Swipe RIGHT → prev tab
//   - Tab order matches BottomNav.tsx
//
// Ignored when:
//   - touch starts inside an interactive control (input/textarea/select/button)
//   - touch starts inside a horizontally scrollable area (.scroll-x, the
//     product table). We don't want a horizontal table scroll to also flip
//     the tab.
//   - touch starts inside an element with `data-no-swipe` (escape hatch).
//   - vertical movement > 50px (likely a scroll, not a swipe).
//   - horizontal movement < 70px (too small to be intentional).
//   - touch duration > 500ms (slow drag, probably not a flick).

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

// Must match BottomNav.tsx tab order
const TABS = ["/", "/pocket", "/calculator", "/analyze", "/chat"] as const;

const MIN_HORIZONTAL_PX = 70;
const MAX_VERTICAL_PX = 50;
const MAX_DURATION_MS = 500;

export function SwipeNavigator() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only on touch devices — desktop pointer interactions shouldn't fire this.
    const isTouch = "ontouchstart" in window;
    if (!isTouch) return;

    let startX = 0, startY = 0, startT = 0;
    let startEl: HTMLElement | null = null;
    let active = false;

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
      startEl = e.target as HTMLElement | null;
      active = true;
    }

    function onEnd(e: TouchEvent) {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startT;

      // Magnitude + duration checks
      if (Math.abs(dx) < MIN_HORIZONTAL_PX) return;
      if (Math.abs(dy) > MAX_VERTICAL_PX) return;
      if (dt > MAX_DURATION_MS) return;

      // Skip if the swipe started inside something interactive
      if (!startEl) return;
      const blocker = startEl.closest(
        "input, textarea, select, button, a, " +
        ".scroll-x, .overflow-x-auto, .overflow-y-auto, " +
        "[data-no-swipe]"
      );
      if (blocker) return;

      // Compute current tab index
      const currentIdx = TABS.findIndex((tab) =>
        tab === "/" ? pathname === "/" : pathname.startsWith(tab)
      );
      if (currentIdx === -1) return;

      // dx NEGATIVE = finger moved left = user wants the NEXT (right-side) tab
      // dx POSITIVE = finger moved right = user wants the PREVIOUS (left-side) tab
      const nextIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
      if (nextIdx < 0 || nextIdx >= TABS.length) return;

      router.push(TABS[nextIdx]);
    }

    function onCancel() { active = false; }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [pathname, router]);

  return null;
}
