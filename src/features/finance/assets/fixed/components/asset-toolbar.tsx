"use client";

import { useEffect, useState } from "react";
import { LayoutList, ListTree, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FacetedFilter, type FilterDef } from "@/components/data-table/faceted-filter";
import { useTableUrl } from "@/components/data-table";
import { cn } from "@/lib/utils";

export type RegisterLayout = "groups" | "register";

/**
 * Search, filters and the layout switch of the asset and investment registers. Everything is kept
 * in the URL (?q, filter keys, ?layout=register) so the server filters and links can be shared.
 */
export function AssetToolbar({
  filters,
  layout,
  searchPlaceholder,
  actions,
}: {
  filters: FilterDef[];
  layout?: RegisterLayout;
  searchPlaceholder: string;
  actions?: React.ReactNode;
}) {
  const url = useTableUrl();
  const [search, setSearch] = useState(url.get("q") ?? "");

  useEffect(() => {
    const current = url.get("q") ?? "";
    if (search === current) return;
    const handle = window.setTimeout(() => url.set({ q: search || null }), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const active = Boolean(url.get("q")) || filters.some((f) => url.getList(f.key).length > 0);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", url.isPending && "opacity-70")}>
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="h-8 pl-8 max-md:h-10" aria-label="Search" />
      </div>
      {filters.map((f) => (
        <FacetedFilter key={f.key} title={f.title} options={f.options} selected={url.getList(f.key)} onChange={(values) => url.set({ [f.key]: values.length ? values : null })} />
      ))}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 max-md:h-10"
          onClick={() => {
            setSearch("");
            url.set(Object.fromEntries([["q", null], ...filters.map((f) => [f.key, null])]));
          }}
        >
          Reset <X />
        </Button>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full">
        {actions}
        {layout ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={layout}
            onValueChange={(v) => v && url.set({ layout: v === "register" ? "register" : null }, { resetPage: false })}
            aria-label="Layout"
          >
            <ToggleGroupItem value="groups" className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
              <ListTree /> By group
            </ToggleGroupItem>
            <ToggleGroupItem value="register" className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
              <LayoutList /> Register
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </div>
    </div>
  );
}
