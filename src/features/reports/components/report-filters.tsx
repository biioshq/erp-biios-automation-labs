"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DateRangeFilter, useTableUrl } from "@/components/data-table";
import { FacetedFilter, type FilterOption } from "@/components/data-table/faceted-filter";
import { cn } from "@/lib/utils";
import type { ReportFilterKey, ReportInfo } from "../catalog";
import { PL_COLUMN_OPTIONS } from "../schemas";
import type { ReportFilters } from "../types";
import { AsOfFilter } from "./as-of-filter";

export type FilterMeta = Pick<ReportInfo, "type" | "filters" | "categories">;

export type ReportFilterOptions = {
  projects: FilterOption[];
  vendors: FilterOption[];
  categories: FilterOption[];
};

/** Which filters apply to a report right now (inventory switches between valuation and ledger). */
export function activeFilters(meta: FilterMeta, movements: boolean): ReportFilterKey[] {
  if (meta.type === "inventory") return movements ? ["date", "project", "vendor", "category"] : ["category"];
  return meta.filters;
}

/** Filters for the selected report. State lives in the URL, so a report is shareable. */
export function ReportFilterBar({
  meta,
  filters,
  options,
  className,
  only,
}: {
  /** Plain fields only: a client component cannot receive the meta's icon component. */
  meta: FilterMeta;
  filters: ReportFilters;
  options: ReportFilterOptions;
  className?: string;
  /** Limits the bar to these filters (a page that shares its URL with other controls). */
  only?: ReportFilterKey[];
}) {
  const url = useTableUrl();
  const shown = only ?? activeFilters(meta, filters.movements);
  const has = (k: ReportFilterKey) => shown.includes(k);
  const dirty =
    (has("date") && (filters.from || filters.to)) ||
    (has("asOf") && filters.to) ||
    (has("project") && filters.project.length) ||
    (has("vendor") && filters.vendor.length) ||
    (has("category") && filters.category.length);

  return (
    <div
      className={cn("grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap [&>*]:min-w-0", className)}
      aria-busy={url.isPending}
    >
      {has("date") ? (
        <div className="col-span-2 sm:col-auto max-sm:[&>button]:w-full max-sm:[&>button]:justify-start">
          <DateRangeFilter from={filters.from} to={filters.to} onChange={(r) => url.set({ from: r.from, to: r.to })} label="Period" />
        </div>
      ) : null}
      {has("asOf") ? (
        <div className="col-span-2 sm:col-auto max-sm:[&>button]:w-full max-sm:[&>button]:justify-start">
          <AsOfFilter value={filters.to} onChange={(d) => url.set({ to: d, from: null })} />
        </div>
      ) : null}
      {has("columns") ? (
        <div className="col-span-2 sm:col-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={filters.columns ?? "total"}
            onValueChange={(v) => v && url.set({ columns: v === "total" ? null : v })}
            aria-label="Columns"
            className="max-sm:w-full"
          >
            {PL_COLUMN_OPTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value} className="px-3 text-[13px] max-md:h-10 max-sm:flex-1 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
      {has("project") ? (
        <div className="max-sm:[&>button]:w-full max-sm:[&>button]:justify-start">
          <FacetedFilter title="Project" options={options.projects} selected={filters.project} onChange={(v) => url.set({ project: v })} />
        </div>
      ) : null}
      {has("vendor") ? (
        <div className="max-sm:[&>button]:w-full max-sm:[&>button]:justify-start">
          <FacetedFilter title="Vendor" options={options.vendors} selected={filters.vendor} onChange={(v) => url.set({ vendor: v })} />
        </div>
      ) : null}
      {has("category") ? (
        <div className="max-sm:[&>button]:w-full max-sm:[&>button]:justify-start">
          <FacetedFilter title="Category" options={options.categories} selected={filters.category} onChange={(v) => url.set({ category: v })} />
        </div>
      ) : null}
      {meta.type === "inventory" && !only ? (
        <div className="col-span-2 flex items-center gap-2 rounded-lg border px-3 py-1 max-md:min-h-10 sm:col-auto">
          <Switch
            id="report-movements"
            checked={filters.movements}
            onCheckedChange={(on) => url.set({ movements: on ? "1" : null, from: on ? filters.from : null, to: on ? filters.to : null })}
          />
          <Label htmlFor="report-movements" className="text-[13px] font-normal">
            Movement ledger
          </Label>
        </div>
      ) : null}
      {dirty ? (
        <Button
          variant="ghost"
          size="sm"
          className="col-span-2 h-8 px-2 sm:col-auto"
          onClick={() =>
            url.set({
              ...(has("date") || has("asOf") ? { from: null, to: null } : {}),
              ...(has("project") ? { project: null } : {}),
              ...(has("vendor") ? { vendor: null } : {}),
              ...(has("category") ? { category: null } : {}),
            })
          }
        >
          <RotateCcw className="opacity-70" /> Reset
        </Button>
      ) : null}
    </div>
  );
}
