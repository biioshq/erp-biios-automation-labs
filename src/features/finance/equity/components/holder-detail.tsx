"use client";

import { Archive, ArchiveRestore, ArrowUpFromLine, Landmark, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/current-user";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { INVESTOR_INSTRUMENTS, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { ENTRY_TONES, HOLDER_KIND_LABELS, entryTypeLabel } from "../labels";
import type { HolderDetail } from "../types";

function Figure({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-surface px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Money value={value} className="mt-1 block font-semibold" />
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** An owner's or investor's record: totals, contact details and every entry in date order. */
export function HolderDetailView({
  holder,
  onEdit,
  onRecord,
  onOpenEntry,
  onArchive,
  onRestore,
  onDelete,
}: {
  holder: HolderDetail;
  onEdit: () => void;
  onRecord: (type: "capital" | "drawing") => void;
  onOpenEntry: (id: string) => void;
  onArchive: () => Promise<boolean>;
  onRestore: () => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const kind = HOLDER_KIND_LABELS[holder.kind];
  // These only hide controls; the actions check the same permissions on the server.
  const canCreate = useCan("finance.equity:create");
  const canEdit = useCan("finance.equity:edit");
  const canDelete = useCan("finance.equity:delete");
  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={holder.kind === "owner" ? "brand" : "info"} dot={false}>
              {kind.one}
            </StatusBadge>
            {holder.archived ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
            {holder.ownershipPercent !== null ? (
              <StatusBadge tone="neutral" dot={false}>
                {holder.ownershipPercent}% ownership
              </StatusBadge>
            ) : null}
            {holder.instrument ? (
              <StatusBadge tone="neutral" dot={false}>
                {labelOf(INVESTOR_INSTRUMENTS, holder.instrument)}
              </StatusBadge>
            ) : null}
          </div>
          <Money value={holder.net} exact className="block text-3xl font-semibold tracking-tight" />
          <p className="text-sm text-muted-foreground">
            {holder.kind === "owner" ? "Current capital balance: capital introduced less drawings." : "Capital contributed less anything withdrawn."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Figure label="Initial capital" value={holder.initial} hint={holder.firstContribution ? `From ${formatDate(holder.firstContribution)}` : undefined} />
          <Figure label="Additional capital" value={holder.additional} />
          <Figure label="Total introduced" value={holder.capital} hint={holder.lastContribution ? `Last ${formatDate(holder.lastContribution)}` : undefined} />
          {holder.kind === "owner" || holder.drawings ? <Figure label="Drawings" value={holder.drawings} /> : null}
          {holder.dividends ? <Figure label="Dividends received" value={holder.dividends} /> : null}
        </div>

        {holder.email || holder.phone ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {holder.email ? (
              <a href={`mailto:${holder.email}`} className="inline-flex items-center gap-2 hover:underline">
                <Mail className="size-4 text-muted-foreground" /> {holder.email}
              </a>
            ) : null}
            {holder.phone ? (
              <a href={`tel:${holder.phone}`} className="inline-flex items-center gap-2 hover:underline">
                <Phone className="size-4 text-muted-foreground" /> {holder.phone}
              </a>
            ) : null}
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">History</h3>
            {holder.archived || !canCreate ? null : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onRecord("capital")}>
                  <Plus /> Record capital
                </Button>
                {holder.kind === "owner" ? (
                  <Button size="sm" variant="outline" onClick={() => onRecord("drawing")}>
                    <ArrowUpFromLine /> Record drawing
                  </Button>
                ) : null}
              </div>
            )}
          </div>
          {holder.history.length ? (
            <ul className="divide-y rounded-xl border">
              {holder.history.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpenEntry(e.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
                    <div className="min-w-0 flex-1 space-y-1">
                      <StatusBadge tone={ENTRY_TONES[e.type]} dot={false} className="h-5 px-2 text-[11px]">
                        {entryTypeLabel(e.type)}
                        {e.type === "capital" && e.initial !== null ? (e.initial ? " · initial" : " · additional") : ""}
                      </StatusBadge>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{e.number}</span> · {formatDate(e.date)}
                        {e.reference ? ` · ${e.reference}` : ""}
                      </p>
                    </div>
                    <Money value={e.type === "capital" ? e.amount : -e.amount} tone={e.type === "capital" ? "positive" : "negative"} className="shrink-0 font-semibold" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <Landmark className="size-4 shrink-0" /> Nothing recorded for {holder.name} yet.
            </p>
          )}
        </section>

        {holder.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{holder.notes}</p>
          </section>
        ) : null}
      </FormSheetBody>
      <FormSheetFooter>
        {canEdit && holder.entries === 0 && holder.archived ? (
          <Button variant="ghost" onClick={() => void onRestore()}>
            <ArchiveRestore /> Restore
          </Button>
        ) : null}
        {holder.entries === 0 ? (
          canDelete ? (
            <ConfirmDialog
              title={`Delete ${holder.name}?`}
              description="They have no entries, so nothing else changes."
              onConfirm={onDelete}
              trigger={
                <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                  <Trash2 /> Delete
                </Button>
              }
            />
          ) : null
        ) : !canEdit ? null : holder.archived ? (
          <Button variant="ghost" className="mr-auto" onClick={() => void onRestore()}>
            <ArchiveRestore /> Restore
          </Button>
        ) : (
          <ConfirmDialog
            title={`Archive ${holder.name}?`}
            description="They leave the pickers. Their capital and history stay and keep counting in equity. You can restore them later."
            confirmLabel="Archive"
            destructive={false}
            onConfirm={onArchive}
            trigger={
              <Button variant="ghost" className="mr-auto">
                <Archive /> Archive
              </Button>
            }
          />
        )}
        {canEdit ? (
          <Button onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
      </FormSheetFooter>
    </>
  );
}
