"use client";

// SwipeNavigator — proper swipeable tabs.
// The <main> element follows the finger horizontally as the user drags.
// On release: if dragged past threshold (or with enough velocity), the page
// completes its slide off-screen and we router.push to the next tab; the
// new tab renders in place. Otherwise the page snaps back to centre.
//
// Mounted once at the root layout. Returns null — just installs listeners.

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

const TABS = ["/", "/pocket", "/calculator", "/analyze", "/chat"] as const;

// Tuning
const THRESHOLD_PX = 80;        // dragged past this → commit
const VELOCITY_THRESHOLD = 0.5; // px/ms — a quick flick commits even at smaller distance
const COMMIT_MS = 220;          // duration of the "finish the slide off-screen" animation
const SNAPBACK_MS = 250;        // duration of the "spring back to centre" animation
const HORIZ_BIAS_PX = 10;       // need at least this much horizontal movement before claiming the gesture

export function SwipeNavigator() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("ontouchstart" in window)) return;

    const main = document.querySelector("main") as HTMLElement | null;
    if (!main) return;
    const body = document.body;

    let startX = 0, startY = 0, startT = 0;
    let startEl: HTMLElement | null = null;
    let active = false;
    let dragging = false;
    let dx = 0;
    let canGoNext = false;
    let canGoPrev = false;

    function currentIdx(): number {
      return TABS.findIndex((tab) =>
        tab === "/" ? pathname === "/" : pathname.startsWith(tab)
      );
    }

    function clearTransform() {
      main!.style.transition = "";
      main!.style.transform = "";
      // Critical: remove will-change too. With it set, the browser keeps
      // <main> as a composite layer, which inadvertently makes it the
      // containing block for any fixed-positioned descendant (e.g. the
      // chat page's outer wrapper). That breaks the chat layout — the
      // conversation list gets sized against <main>'s height rather than
      // the viewport, and collapses to zero.
      main!.style.willChange = "";
      body.style.overflowX = "";
      body.style.touchAction = "";
    }

    function snapBack() {
      main!.style.transition = `transform ${SNAPBACK_MS}ms cubic-bezier(.22,.61,.36,1)`;
      main!.style.transform = "translateX(0)";
      window.setTimeout(clearTransform, SNAPBACK_MS + 30);
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
      startEl = e.target as HTMLElement | null;
      active = true;
      dragging = false;
      dx = 0;
    }

    function onMove(e: TouchEvent) {
      if (!active) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;

      if (!dragging) {
        // Wait until we have meaningful horizontal motion before claiming.
        if (Math.abs(mx) < HORIZ_BIAS_PX) return;
        // If the user is mostly moving vertically, this is a scroll — release.
        if (Math.abs(my) > Math.abs(mx)) { active = false; return; }

        // Skip if started in something interactive or already-scrollable.
        if (startEl) {
          const blocker = startEl.closest(
            "input, textarea, select, button, a, " +
            ".scroll-x, .overflow-x-auto, .overflow-y-auto, " +
            "[data-no-swipe]"
          );
          if (blocker) { active = false; return; }
        }

        // Compute boundaries — at left edge of Desk no prev, right edge of Chat no next.
        const idx = currentIdx();
        if (idx === -1) { active = false; return; }
        canGoNext = idx < TABS.length - 1;
        canGoPrev = idx > 0;

        if (mx < 0 && !canGoNext) { active = false; return; }
        if (mx > 0 && !canGoPrev) { active = false; return; }

        dragging = true;
        // Stop vertical browser scrolling for the rest of this gesture.
        // Also lock body horizontal overflow so the off-screen sliver doesn't
        // give the user a horizontal scrollbar.
        body.style.overflowX = "hidden";
        body.style.touchAction = "pan-y"; // allow vertical scroll outside if user changes mind
        main!.style.transition = "none";
        // Set will-change only while dragging — promotes main to its own
        // composite layer for smooth GPU compositing during the swipe.
        // Cleared in clearTransform() once the gesture completes.
        main!.style.willChange = "transform";
      }

      dx = mx;

      // Slight resistance past the threshold so the user feels a soft limit
      // even though we're about to commit. Just dx for now (linear feel).
      main!.style.transform = `translate3d(${dx}px, 0, 0)`;

      // Prevent the page from scrolling vertically while we're dragging horizontally.
      // `preventDefault` only works because touchmove is registered passive:false.
      if (e.cancelable) e.preventDefault();
    }

    function onEnd(e: TouchEvent) {
      if (!active) { return; }
      active = false;
      if (!dragging) { return; }

      const dt = Math.max(1, Date.now() - startT);
      const velocity = Math.abs(dx) / dt;          // px/ms
      const past = Math.abs(dx) > THRESHOLD_PX;
      const fast = velocity > VELOCITY_THRESHOLD;

      const idx = currentIdx();
      const wantNext = dx < 0;
      const target = wantNext ? idx + 1 : idx - 1;
      const targetOK = target >= 0 && target < TABS.length;

      if (!(past || fast) || !targetOK) {
        snapBack();
        return;
      }

      // Commit — slide the rest of the way off-screen, then navigate.
      const w = window.innerWidth;
      const targetX = wantNext ? -w : w;
      main!.style.transition = `transform ${COMMIT_MS}ms cubic-bezier(.22,.61,.36,1)`;
      main!.style.transform = `translate3d(${targetX}px, 0, 0)`;

      window.setTimeout(() => {
        router.push(TABS[target]);
        // After Next routes, the layout's <main> stays mounted but its
        // children get replaced. Reset the transform AND will-change on
        // the next frame so the new content snaps to centre with the
        // viewport as containing block (essential for chat's position:
        // fixed layout).
        requestAnimationFrame(() => {
          clearTransform();
        });
      }, COMMIT_MS);
    }

    function onCancel() {
      if (dragging) snapBack();
      active = false;
      dragging = false;
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    // touchmove must be passive:false so we can preventDefault and stop
    // the page from scrolling during a horizontal drag.
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove as any);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      clearTransform();
    };
  }, [pathname, router]);

  return null;
}
