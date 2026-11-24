"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormSheet } from "@/components/shared/form-sheet";
import { useOnLiveChange } from "@/components/live-updates";
import { emitDataChanged } from "@/lib/events";
import { formatDate } from "@/lib/format";
import type { CapitalEntryType, EquityHolderKind } from "@/lib/constants";
import type { BankAccountOption } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { archiveHolder, deleteEntry, deleteHolder, fetchEntry, fetchHolder, restoreHolder } from "../actions";
import { HOLDER_KIND_LABELS, NEW_ENTRY_TITLES, entryTypeLabel } from "../labels";
import type { EntryDetail, HolderDetail, HolderOption } from "../types";
import { EntryForm } from "./entry-form";
import { DetailSkeleton, EntryDetailView } from "./entry-detail";
import { HolderForm } from "./holder-form";
import { HolderDetailView } from "./holder-detail";
import { useEquityPanel } from "./use-equity-panel";

type Loaded = { kind: "entry"; data: EntryDetail } | { kind: "holder"; data: HolderDetail } | null;

/**
 * Every drawer of the equity pages in one place: record, view and edit entries, and add, view and
 * edit owners and investors. Pages render it once; tables and buttons open drawers through the URL.
 */
export function EquityPanels({
  holders,
  accounts,
  reserveGroups,
  reserveParents,
  defaultNew = "capital",
  defaultKind = "owner",
  openingDate,
}: {
  holders: HolderOption[];
  accounts: BankAccountOption[];
  reserveGroups: GroupOption[];
  reserveParents: GroupOption[];
  /** What ?new=1 opens on this page. */
  defaultNew?: CapitalEntryType;
  /** The role a new person gets on this page. */
  defaultKind?: EquityHolderKind;
  /** Suggested date for retained earnings before the books started: the day before the first record. */
  openingDate?: string | null;
}) {
  const router = useRouter();
  const { panel, open, close } = useEquityPanel(defaultNew);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [version, setVersion] = useState(0);

  const target: { kind: "entry" | "holder"; id: string } | null =
    panel?.kind === "viewEntry" || panel?.kind === "editEntry"
      ? { kind: "entry", id: panel.id }
      : panel?.kind === "viewHolder" || panel?.kind === "editHolder"
        ? { kind: "holder", id: panel.id }
        : null;
  const targetKey = target ? `${target.kind}:${target.id}` : null;
  const loadedKey = loaded ? `${loaded.kind}:${loaded.data.id}` : null;
  // Closing the drawer drops the cached record, so the next open shows fresh figures.
  if (!targetKey && loaded) setLoaded(null);

  useEffect(() => {
    if (!target) return;
    if (loadedKey === targetKey) return;
    let cancelled = false;
    const request = target.kind === "entry" ? fetchEntry(target.id) : fetchHolder(target.id);
    request
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error(target.kind === "entry" ? "That entry no longer exists." : "That owner or investor no longer exists.");
          close();
          return;
        }
        setLoaded(target.kind === "entry" ? { kind: "entry", data: d as EntryDetail } : { kind: "holder", data: d as HolderDetail });
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load it. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, version]);

  // Someone else changed data: reload what is being shown, never a form that is being filled in.
  const viewing = useRef<string | null>(null);
  useEffect(() => {
    viewing.current = panel?.kind === "viewEntry" || panel?.kind === "viewHolder" ? targetKey : null;
  });
  useOnLiveChange(() => {
    if (viewing.current && viewing.current === loadedKey) {
      setLoaded(null);
      setVersion((v) => v + 1);
    }
  });

  async function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>, done: string, after?: () => void) {
    const result = await action();
    if (!result.ok) {
      toast.error(result.error ?? "Something went wrong.");
      return false;
    }
    toast.success(done);
    viewing.current = null;
    emitDataChanged();
    after?.();
    router.refresh();
    return true;
  }

  const reload = () => {
    setLoaded(null);
    setVersion((v) => v + 1);
  };

  const entry = loaded?.kind === "entry" && loaded.data.id === target?.id ? loaded.data : null;
  const holder = loaded?.kind === "holder" && loaded.data.id === target?.id ? loaded.data : null;
  const waiting = Boolean(target) && !entry && !holder;

  let title: React.ReactNode = "";
  let description: React.ReactNode = undefined;
  let size: "md" | "lg" = "md";
  let body: React.ReactNode = null;

  if (panel?.kind === "newEntry") {
    const meta = NEW_ENTRY_TITLES[panel.type];
    title = meta.title;
    description = meta.description;
    size = "lg";
    body = (
      <EntryForm
        key={`${panel.type}:${panel.holderId ?? ""}`}
        type={panel.type}
        holderId={panel.holderId}
        defaultKind={defaultKind}
        defaultDate={panel.type === "opening_retained" ? (openingDate ?? undefined) : undefined}
        holders={holders}
        accounts={accounts}
        reserveGroups={reserveGroups}
        reserveParents={reserveParents}
        onDone={(id) => {
          router.refresh();
          open({ kind: "viewEntry", id });
        }}
        onCancel={close}
      />
    );
  } else if (panel?.kind === "newHolder") {
    const kind = panel.holderKind ?? defaultKind;
    title = kind === "investor" ? "Add investor" : "Add owner";
    description = "One record per person or firm. Their money is recorded as capital entries.";
    body = (
      <HolderForm
        defaultKind={kind}
        onDone={(id) => {
          router.refresh();
          open({ kind: "viewHolder", id });
        }}
        onCancel={close}
      />
    );
  } else if (target && waiting) {
    title = target.kind === "entry" ? "Equity entry" : "Owner or investor";
    body = <DetailSkeleton />;
  } else if (panel?.kind === "viewEntry" && entry) {
    title = entryTypeLabel(entry.type);
    description = `${entry.number} · ${formatDate(entry.date)}`;
    body = (
      <EntryDetailView
        entry={entry}
        onEdit={() => open({ kind: "editEntry", id: entry.id })}
        onDelete={() => run(() => deleteEntry({ id: entry.id }), `${entry.number} deleted`, close)}
      />
    );
  } else if (panel?.kind === "editEntry" && entry) {
    title = `Edit ${entryTypeLabel(entry.type).toLowerCase()}`;
    description = entry.number;
    size = "lg";
    body = (
      <EntryForm
        // Keyed by the record only: a refresh must never remount the form and drop what is being typed.
        key={entry.id}
        type={entry.type}
        entry={entry}
        holders={holders}
        accounts={accounts}
        reserveGroups={reserveGroups}
        reserveParents={reserveParents}
        onDone={(id) => {
          reload();
          router.refresh();
          open({ kind: "viewEntry", id });
        }}
        onCancel={() => open({ kind: "viewEntry", id: entry.id })}
      />
    );
  } else if (panel?.kind === "viewHolder" && holder) {
    title = holder.name;
    description = `${HOLDER_KIND_LABELS[holder.kind].one}${holder.firstContribution ? ` since ${formatDate(holder.firstContribution)}` : ""}`;
    body = (
      <HolderDetailView
        holder={holder}
        onEdit={() => open({ kind: "editHolder", id: holder.id })}
        onRecord={(type) => open({ kind: "newEntry", type, holderId: holder.id })}
        onOpenEntry={(id) => open({ kind: "viewEntry", id })}
        onArchive={() => run(() => archiveHolder({ id: holder.id }), `${holder.name} archived`, reload)}
        onRestore={() => run(() => restoreHolder({ id: holder.id }), `${holder.name} restored`, reload)}
        onDelete={() => run(() => deleteHolder({ id: holder.id }), `${holder.name} deleted`, close)}
      />
    );
  } else if (panel?.kind === "editHolder" && holder) {
    title = `Edit ${holder.name}`;
    body = (
      <HolderForm
        key={holder.id}
        holder={holder}
        onDone={(id) => {
          reload();
          router.refresh();
          open({ kind: "viewHolder", id });
        }}
        onCancel={() => open({ kind: "viewHolder", id: holder.id })}
      />
    );
  }

  return (
    <FormSheet open={panel !== null} onOpenChange={(o) => !o && close()} size={size} title={title} description={description}>
      {body}
    </FormSheet>
  );
}
