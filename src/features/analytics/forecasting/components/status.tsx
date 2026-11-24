"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ForecastStatus } from "../types";

const META: Record<ForecastStatus, { label: string; tone: "brand" | "neutral" | "warning" }> = {
  forecast: { label: "Forecast", tone: "brand" },
  no_use: { label: "No recent use", tone: "neutral" },
  insufficient: { label: "Not enough history", tone: "warning" },
};

/** Whether an item has a forecast, with the reason when it has none. */
export function ForecastStatusBadge({ status }: { status: ForecastStatus }) {
  const meta = META[status];
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

/** An inventory item's name linking to its page, with its SKU under it. */
export function ItemLink({ id, name, sku, sub }: { id: string; name: string; sku: string; sub?: string | null }) {
  return (
    <Link href={`/inventory/items/${id}`} className="block min-w-44 max-w-64" onClick={(e) => e.stopPropagation()}>
      <span className="block truncate font-medium hover:underline">{name}</span>
      <span className="block truncate text-[11px] text-muted-foreground">
        <span className="font-mono">{sku}</span>
        {sub ? ` · ${sub}` : null}
      </span>
    </Link>
  );
}

/** A project's name linking to its finance page, with its colour and code. */
export function ProjectLink({ id, name, code, color, href }: { id: string; name: string; code: string; color: string; href?: string }) {
  return (
    <Link href={href ?? `/finance/projects/${id}`} className="flex min-w-44 items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium hover:underline">{name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{code}</span>
      </span>
    </Link>
  );
}
