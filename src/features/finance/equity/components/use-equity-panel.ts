"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CAPITAL_ENTRY_TYPES, EQUITY_HOLDER_KINDS, type CapitalEntryType, type EquityHolderKind } from "@/lib/constants";

/**
 * Which drawer is open on an equity page. Drawers follow the URL so the balance sheet, the command
 * palette and other pages can link straight to a record:
 *   ?view=<entry id>, ?edit=<entry id>, ?new=1 (the page's default entry) or ?new=<entry type>&for=<holder id>,
 *   ?holder=<holder id>, ?holder=new&kind=<owner|investor>, ?editHolder=<holder id>.
 */
export type EquityPanel =
  | { kind: "newEntry"; type: CapitalEntryType; holderId?: string }
  | { kind: "viewEntry"; id: string }
  | { kind: "editEntry"; id: string }
  | { kind: "newHolder"; holderKind?: EquityHolderKind }
  | { kind: "viewHolder"; id: string }
  | { kind: "editHolder"; id: string }
  | null;

const KEYS = ["new", "for", "view", "edit", "holder", "kind", "editHolder"];
const isType = (v: string | null): v is CapitalEntryType => CAPITAL_ENTRY_TYPES.some((t) => t.value === v);
const isKind = (v: string | null): v is EquityHolderKind => EQUITY_HOLDER_KINDS.some((k) => k.value === v);

/** The query string for a panel, keeping the page's other parameters. */
export function panelQuery(current: URLSearchParams, panel: EquityPanel): string {
  const params = new URLSearchParams(current.toString());
  for (const k of KEYS) params.delete(k);
  if (panel?.kind === "newEntry") {
    params.set("new", panel.type);
    if (panel.holderId) params.set("for", panel.holderId);
  } else if (panel?.kind === "viewEntry") params.set("view", panel.id);
  else if (panel?.kind === "editEntry") params.set("edit", panel.id);
  else if (panel?.kind === "newHolder") {
    params.set("holder", "new");
    if (panel.holderKind) params.set("kind", panel.holderKind);
  } else if (panel?.kind === "viewHolder") params.set("holder", panel.id);
  else if (panel?.kind === "editHolder") params.set("editHolder", panel.id);
  return params.toString();
}

export function useEquityPanel(defaultNew: CapitalEntryType = "capital") {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const panel: EquityPanel = useMemo(() => {
    const created = searchParams.get("new");
    if (created) return { kind: "newEntry", type: isType(created) ? created : defaultNew, holderId: searchParams.get("for") ?? undefined };
    const edit = searchParams.get("edit");
    if (edit) return { kind: "editEntry", id: edit };
    const view = searchParams.get("view");
    if (view) return { kind: "viewEntry", id: view };
    const editHolder = searchParams.get("editHolder");
    if (editHolder) return { kind: "editHolder", id: editHolder };
    const holder = searchParams.get("holder");
    if (holder === "new") {
      const kind = searchParams.get("kind");
      return { kind: "newHolder", holderKind: isKind(kind) ? kind : undefined };
    }
    if (holder) return { kind: "viewHolder", id: holder };
    return null;
  }, [searchParams, defaultNew]);

  const open = (next: EquityPanel) => {
    const qs = panelQuery(searchParams, next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return { panel, open, close: () => open(null) };
}
