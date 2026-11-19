"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Reads and writes list state in the URL (?q, page, size, sort, filters, from, to)
 * inside a transition, so the server re-renders the page and `isPending` can
 * dim the table meanwhile.
 */
export function useTableUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const get = useCallback((key: string) => searchParams.get(key), [searchParams]);
  const getList = useCallback(
    (key: string) => (searchParams.get(key) ?? "").split(",").filter(Boolean),
    [searchParams],
  );

  const set = useCallback(
    (updates: Record<string, string | string[] | null | undefined>, options: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const v = Array.isArray(value) ? value.join(",") : value;
        if (v === null || v === undefined || v === "") next.delete(key);
        else next.set(key, v);
      }
      if (options.resetPage !== false && !("page" in updates)) next.delete("page");
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return { get, getList, set, isPending, searchParams };
}
