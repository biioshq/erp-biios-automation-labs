"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Fired on window after a live refresh; the notifications menu already reloads on it. */
export const LIVE_CHANGE_EVENT = "erp:data-changed";

const EVERY_MS = 15_000;

/**
 * Keeps open pages current when other people change data: every 15 seconds while the tab is
 * visible, and as soon as it becomes visible again, it asks /api/live whether anything changed
 * and, if so, re-renders the page's server data. Typing, open sheets and table filters are kept.
 */
export function LiveUpdates() {
  const router = useRouter();
  const seen = useRef<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    async function check() {
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) return;
        const { v } = (await res.json()) as { v: number };
        if (seen.current !== null && v !== seen.current) {
          startTransition(() => router.refresh());
          window.dispatchEvent(new Event(LIVE_CHANGE_EVENT));
        }
        seen.current = v;
      } catch {
        // Offline or a deploy in progress: try again on the next tick.
      } finally {
        busy.current = false;
      }
    }
    void check();
    const timer = window.setInterval(check, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  return null;
}

/**
 * Calls `onChange` when data changed: someone else's change seen by <LiveUpdates>, or a change
 * made in this tab (emitDataChanged). For panels that load a record on the client, such as an
 * open detail drawer: re-fetch it here, but not while an edit form is open (it would drop typing).
 */
export function useOnLiveChange(onChange: () => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(LIVE_CHANGE_EVENT, handler);
    return () => window.removeEventListener(LIVE_CHANGE_EVENT, handler);
  }, []);
}
