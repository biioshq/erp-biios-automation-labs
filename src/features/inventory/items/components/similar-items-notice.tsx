"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Info, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INVENTORY_UNITS, labelOf } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { findSimilarItems } from "../actions";
import { normalizeItemName, normalizeSku } from "../matching";
import type { SimilarItem } from "../types";

/**
 * Looks up items like the one being typed, a moment after typing stops.
 * Answers for an older name are dropped, so a slow reply never shows the wrong item.
 */
export function useSimilarItems(name: string | undefined, sku: string | undefined, enabled: boolean): SimilarItem[] {
  // Each answer is kept with the text it was for, and shown only while that text is still in the form.
  const [answer, setAnswer] = useState<{ key: string; matches: SimilarItem[] } | null>(null);
  const request = useRef(0);
  const typedName = normalizeItemName(name ?? "");
  const typedSku = normalizeSku(sku ?? "");
  const active = enabled && (typedName.length >= 2 || typedSku.length > 0);
  const key = `${typedName}\u0000${typedSku}`;

  useEffect(() => {
    const id = ++request.current;
    if (!active) return;
    const handle = window.setTimeout(async () => {
      const result = await findSimilarItems({ name: typedName, sku: typedSku || undefined });
      if (id !== request.current) return;
      setAnswer({ key: `${typedName}\u0000${typedSku}`, matches: result.ok ? result.data : [] });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [typedName, typedSku, active]);

  return active && answer?.key === key ? answer.matches : [];
}

/** "Already in inventory" under the item name, with a way to buy more of the existing item instead. */
export function SimilarItemsNotice({ matches }: { matches: SimilarItem[] }) {
  if (matches.length === 0) return null;
  return (
    <div role="status" className="space-y-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
      {matches.map((m) => (
        <div key={m.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="min-w-0">
              <span className="font-medium">{m.match === "similar" ? "Similar item in inventory:" : "Already in inventory:"}</span>{" "}
              {m.name}{" "}
              <span className="text-muted-foreground">
                (<span className="font-mono text-xs">{m.sku}</span>,{" "}
                <span className="tabular">{formatNumber(m.available)}</span> {labelOf(INVENTORY_UNITS, m.unit).toLowerCase()} in stock)
              </span>
              {m.match === "sku" ? <span className="block text-xs text-muted-foreground">Same SKU as the one entered.</span> : null}
            </span>
          </p>
          <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">
            <Button type="button" size="sm" asChild>
              <Link href={`/inventory/purchase?item=${m.id}`}>
                <PackagePlus /> Buy more of it
              </Link>
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={`/inventory/items/${m.id}`}>
                <Eye /> Open item
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
