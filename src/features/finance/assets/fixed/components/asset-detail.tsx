"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, ArchiveRestore, CalendarDays, CircleDollarSign, FolderKanban, MapPin, Pencil, Plus, ShieldCheck, Trash2, Undo2, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { DEPARTMENTS, PAYMENT_METHODS, PAYMENT_STATUSES, labelOf } from "@/lib/constants";
import { formatDate, formatDateTime, formatMonth, formatNumber } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { BankAccountOption } from "@/server/lookups";
import { archiveFixedAsset, attachAssetDocuments, deleteMaintenance, removeAssetDocument, removeDisposal, restoreFixedAsset } from "../actions";
import { labelsFor } from "../labels";
import type { AssetDetail, MaintenanceEntryDTO } from "../types";
import { ConditionBadge, methodText } from "./asset-badges";
import { DisposalDialog } from "./disposal-dialog";
import { MaintenanceDialog } from "./maintenance-dialog";
import { RecordDocuments } from "./record-documents";

function Row({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

const none = (text = "Not recorded") => <span className="text-muted-foreground">{text}</span>;

export function AssetDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </FormSheetBody>
  );
}

function FundingText({ asset }: { asset: AssetDetail }) {
  const f = asset.funding;
  if (f.mode === "expense" && f.expense) {
    return (
      <div className="space-y-1">
        <Link href={`/finance/expenses?view=${f.expense.id}`} className="font-mono text-[13px] font-medium hover:underline">
          {f.expense.number}
        </Link>
        <span className="text-muted-foreground"> · {f.expense.vendor} · </span>
        <Money value={f.expense.amount} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={f.expense.status === "paid" ? "success" : f.expense.status === "overdue" ? "danger" : "warning"} dot={false}>
            {labelOf(PAYMENT_STATUSES, f.expense.status)}
          </StatusBadge>
          {f.expense.outstanding > 0 ? (
            <span className="text-xs text-muted-foreground">
              <Money value={f.expense.outstanding} /> still owed
            </span>
          ) : null}
        </div>
      </div>
    );
  }
  if (f.mode === "expense") return none("The linked expense was deleted. The asset is carried at cost against opening balances.");
  if (f.mode === "paid") {
    return (
      <span>
        {labelOf(PAYMENT_METHODS, f.paymentMethod ?? "bank_transfer")}
        {f.account ? ` from ${f.account.name}` : ", default account"}
      </span>
    );
  }
  return <span>Owned before the books started</span>;
}

function Schedule({ asset }: { asset: AssetDetail }) {
  const labels = labelsFor(asset.kind);
  if (!asset.schedule.length) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {asset.depreciationMethod === "none" ? `This asset is not depreciated, so it stays at cost.` : `No ${labels.chargeLower} to show: the cost less salvage value is zero.`}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Month by month by financial year. Months after this one are planned from the same rules{asset.scheduleCut ? "; written down value never reaches zero, so the next five years are shown" : ""}.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">{labels.charge}</TableHead>
              <TableHead className="text-right">Closing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {asset.schedule.map((y) => (
              <TableRow key={y.label} className="align-top">
                <TableCell colSpan={4} className="p-0">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-2 text-sm [&::-webkit-details-marker]:hidden">
                      <span className="w-28 shrink-0 font-medium">
                        {y.label}
                        {y.planned ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">planned</span> : null}
                      </span>
                      <Money value={y.opening} className="ml-auto w-24 text-right text-muted-foreground" />
                      <Money value={y.charge} className="w-24 text-right" />
                      <Money value={y.closing} className="w-24 text-right font-medium" />
                    </summary>
                    <div className="border-t bg-surface/40 px-2 py-1">
                      {y.months.map((m) => (
                        <div key={m.month} className="flex items-center gap-2 py-1 text-xs">
                          <span className="w-28 shrink-0 text-muted-foreground">
                            {formatMonth(`${m.month}-15`)}
                            {m.planned ? " (planned)" : ""}
                          </span>
                          <span className="ml-auto w-24" />
                          <Money value={m.amount} className="w-24 text-right" />
                          <Money value={m.closing} className="w-24 text-right" />
                        </div>
                      ))}
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Maintenance({
  asset,
  accounts,
  canEdit,
  canDelete,
  onChanged,
}: {
  asset: AssetDetail;
  accounts: BankAccountOption[];
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<MaintenanceEntryDTO | "new" | null>(null);
  const [removing, setRemoving] = useState<MaintenanceEntryDTO | null>(null);

  async function remove() {
    if (!removing) return false;
    const r = await deleteMaintenance({ assetId: asset.id, entryId: removing.id });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("Maintenance entry removed");
    emitDataChanged();
    onChanged();
    return true;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {asset.maintenance.length ? (
            <>
              {asset.maintenance.length} {asset.maintenance.length === 1 ? "entry" : "entries"}, <Money value={asset.maintenanceTotal} /> in all
            </>
          ) : (
            "No maintenance recorded yet."
          )}
        </p>
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus /> Add maintenance
          </Button>
        ) : null}
      </div>
      {asset.maintenance.length ? (
        <div className="divide-y rounded-xl border">
          {asset.maintenance.map((m) => (
            <div key={m.id} className="flex items-start gap-3 px-3 py-2.5">
              <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{m.description}</p>
                  <Money value={m.cost} className="shrink-0 text-sm" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(m.date)}
                  {m.vendor ? ` · ${m.vendor}` : ""}
                  {m.nextDueDate ? ` · next due ${formatDate(m.nextDueDate)}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {m.expense ? (
                    <Link href={`/finance/expenses?view=${m.expense.id}`} className="font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                      Booked as {m.expense.number}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Not booked as an expense</span>
                  )}
                  {canEdit ? (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(m)}>
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-danger hover:text-danger" onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {editing ? (
        <MaintenanceDialog
          key={editing === "new" ? "new" : editing.id}
          assetId={asset.id}
          entry={editing === "new" ? null : editing}
          accounts={accounts}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={onChanged}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this maintenance entry?"
        description={removing?.expense ? `Its expense ${removing.expense.number} stays in Expenses. Delete it there if it should go too.` : "The entry is removed from this asset's log."}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}

/** Read-only view of an asset: figures, schedule, maintenance log, disposal and documents. */
export function AssetDetailView({
  asset,
  accounts,
  canEdit,
  canDelete,
  canDeleteBills,
  onEdit,
  onChanged,
  onDelete,
}: {
  asset: AssetDetail;
  accounts: BankAccountOption[];
  /** These only hide controls; the actions check the same permissions on the server. */
  canEdit: boolean;
  canDelete: boolean;
  /** Asset delete and expense delete: may also delete the unpaid bill the asset created. */
  canDeleteBills: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onDelete: (deleteBill: boolean) => Promise<boolean>;
}) {
  const labels = labelsFor(asset.kind);
  const [disposing, setDisposing] = useState(false);
  const [deleteBill, setDeleteBill] = useState(false);
  const [busy, startTransition] = useTransition();
  const costAboveExpense = asset.funding.expense && asset.purchaseCost > asset.funding.expense.amount + 0.005;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Something went wrong");
        return;
      }
      toast.success(r.message ?? "Saved");
      emitDataChanged();
      onChanged();
    });

  return (
    <>
      <FormSheetBody className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{asset.code}</span>
            <ConditionBadge condition={asset.condition} />
            {asset.isEquipment ? <StatusBadge tone="info" dot={false}>Equipment</StatusBadge> : null}
            {asset.archived ? <StatusBadge tone="neutral" dot={false}>Archived</StatusBadge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{asset.groupPath}</p>
          <div>
            <p className="text-xs text-muted-foreground">{asset.inBooks ? `${labels.value} today` : `${labels.value} when disposed`}</p>
            <Money value={asset.bookValue} exact className="block text-3xl font-semibold tracking-tight" />
          </div>
          <p className="text-sm text-muted-foreground">
            Cost <Money value={asset.purchaseCost} /> · {labels.accumulated.toLowerCase()} <Money value={asset.accumulated} /> · this year <Money value={asset.chargedThisYear} />
          </p>
        </div>

        {costAboveExpense ? (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            The linked expense is now less than the purchase cost. The books use the lower figure for the purchase; edit the cost to match.
          </p>
        ) : null}

        <Tabs defaultValue="details" className="gap-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="schedule">{labels.charge}</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance{asset.maintenance.length ? ` (${asset.maintenance.length})` : ""}</TabsTrigger>
            <TabsTrigger value="documents">Documents{asset.documents.length ? ` (${asset.documents.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-5">
            <div className="divide-y rounded-xl border px-4">
              <Row icon={CalendarDays} label="Purchased">
                {formatDate(asset.purchaseDate)} · {formatNumber(asset.quantity)} {asset.quantity === 1 ? "unit" : "units"}
                {asset.vendor ? <span className="block text-muted-foreground">{asset.vendor}{asset.invoiceNumber ? `, invoice ${asset.invoiceNumber}` : ""}</span> : null}
              </Row>
              <Row icon={CircleDollarSign} label="Paid">
                <FundingText asset={asset} />
              </Row>
              <Row icon={CalendarDays} label={labels.charge}>
                {methodText(asset.depreciationMethod, asset.usefulLifeYears, asset.wdvRate)}
                {asset.salvageValue ? (
                  <span className="block text-muted-foreground">
                    Salvage value <Money value={asset.salvageValue} />
                  </span>
                ) : null}
                {asset.depreciationStart ? <span className="block text-muted-foreground">From {formatDate(asset.depreciationStart)}</span> : null}
              </Row>
              <Row icon={MapPin} label={labels.locationLabel}>
                {asset.location ?? none()}
                {asset.department ? <span className="block text-muted-foreground">{labelOf(DEPARTMENTS, asset.department)}</span> : null}
              </Row>
              <Row icon={User} label="Assigned to">
                {asset.assignedTo ? (
                  <Link href={`/finance/employees/${asset.assignedTo.id}`} className="font-medium hover:underline">
                    {asset.assignedTo.name}
                  </Link>
                ) : (
                  none("Nobody in particular")
                )}
              </Row>
              <Row icon={FolderKanban} label="Project">
                {asset.project ? (
                  <span>
                    <Link href={`/finance/projects/${asset.project.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                      <span className="size-2 rounded-full" style={{ background: asset.project.color }} />
                      {asset.project.name}
                    </Link>
                    {asset.projectUntil ? <span className="text-muted-foreground"> until {formatDate(asset.projectUntil)}</span> : null}
                  </span>
                ) : (
                  none("Not with a project")
                )}
              </Row>
              <Row icon={ShieldCheck} label="Warranty">
                {asset.warrantyUntil ? `Until ${formatDate(asset.warrantyUntil)}` : none()}
                {asset.warrantyNotes ? <span className="block whitespace-pre-wrap text-muted-foreground">{asset.warrantyNotes}</span> : null}
                {asset.nextMaintenanceDue ? <span className="block text-muted-foreground">Next maintenance due {formatDate(asset.nextMaintenanceDue)}</span> : null}
              </Row>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Sale or disposal</h3>
              {asset.disposal ? (
                <div className="space-y-3 rounded-xl border p-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Date</dt>
                      <dd>{formatDate(asset.disposal.date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Proceeds</dt>
                      <dd>
                        <Money value={asset.disposal.amount} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{labels.value} then</dt>
                      <dd>
                        <Money value={asset.disposal.bookValue} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{asset.disposal.gain >= 0 ? "Gain" : "Loss"}</dt>
                      <dd>
                        <Money value={Math.abs(asset.disposal.gain)} tone={asset.disposal.gain >= 0 ? "positive" : "negative"} />
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {asset.disposal.amount > 0 ? `Received into ${asset.disposal.account?.name ?? "the default bank account"}.` : "Nothing received."}
                    {asset.disposal.notes ? ` ${asset.disposal.notes}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && !asset.archived ? (
                      <Button size="sm" variant="outline" onClick={() => setDisposing(true)}>
                        <Pencil /> Edit disposal
                      </Button>
                    ) : null}
                    {canDelete && !asset.archived ? (
                      <ConfirmDialog
                        title="Take this disposal back?"
                        description={`${asset.code} returns to the books and ${labels.chargeLower} continues as if it was never disposed.`}
                        confirmLabel="Take back"
                        destructive={false}
                        onConfirm={() => run(() => removeDisposal({ id: asset.id }))}
                        trigger={
                          <Button size="sm" variant="ghost">
                            <Undo2 /> Take back
                          </Button>
                        }
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
                  <p className="text-sm text-muted-foreground">Still in use. Record a sale, scrapping or loss to take it off the books.</p>
                  {canEdit ? (
                    <Button size="sm" variant="outline" onClick={() => setDisposing(true)}>
                      Record disposal
                    </Button>
                  ) : null}
                </div>
              )}
            </section>

            {asset.description ? (
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">Description</h3>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{asset.description}</p>
              </section>
            ) : null}
            {asset.notes ? (
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">Notes</h3>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{asset.notes}</p>
              </section>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Added {formatDateTime(asset.createdAt)}
              {asset.createdBy ? ` by ${asset.createdBy.name}` : ""}
              {asset.updatedAt !== asset.createdAt ? ` · updated ${formatDateTime(asset.updatedAt)}` : ""}
            </p>
          </TabsContent>

          <TabsContent value="schedule">
            <Schedule asset={asset} />
          </TabsContent>

          <TabsContent value="maintenance">
            <Maintenance asset={asset} accounts={accounts} canEdit={canEdit} canDelete={canDelete} onChanged={onChanged} />
          </TabsContent>

          <TabsContent value="documents">
            <RecordDocuments
              documents={asset.documents}
              canAttach={canEdit}
              canRemove={canDelete}
              attach={(fileIds) => attachAssetDocuments({ id: asset.id, fileIds })}
              remove={(fileId) => removeAssetDocument({ id: asset.id, fileId })}
              onChanged={onChanged}
            />
          </TabsContent>
        </Tabs>
      </FormSheetBody>
      <FormSheetFooter>
        {canDelete ? (
          <ConfirmDialog
            title={`Delete ${asset.code}?`}
            description={
              <span className="space-y-2">
                <span className="block">
                  The asset, its maintenance log and its documents are removed.{" "}
                  {asset.funding.expense ? `${asset.funding.expense.number} stays in Expenses, unlinked. ` : ""}
                  Maintenance expenses stay in Expenses. Archiving after a disposal keeps the history instead.
                </span>
                {asset.deletableBill && canDeleteBills ? (
                  <label className="flex items-center gap-2 text-foreground">
                    <input type="checkbox" checked={deleteBill} onChange={(e) => setDeleteBill(e.target.checked)} className="size-4 accent-current" />
                    Also delete the unpaid bill {asset.deletableBill.number} created with it
                  </label>
                ) : null}
              </span>
            }
            onConfirm={() => onDelete(deleteBill)}
            trigger={
              <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                <Trash2 /> Delete
              </Button>
            }
          />
        ) : null}
        {asset.disposal && canEdit ? (
          asset.archived ? (
            <Button variant="outline" disabled={busy} onClick={() => run(() => restoreFixedAsset({ id: asset.id }))}>
              <ArchiveRestore /> Restore
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => run(() => archiveFixedAsset({ id: asset.id }))}>
              <Archive /> Archive
            </Button>
          )
        ) : null}
        {canEdit ? (
          <Button onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
      </FormSheetFooter>
      {disposing ? <DisposalDialog asset={asset} accounts={accounts} open onOpenChange={setDisposing} onSaved={onChanged} /> : null}
    </>
  );
}
