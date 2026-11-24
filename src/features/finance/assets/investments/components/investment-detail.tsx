"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Building2, CalendarDays, CircleDollarSign, LineChart, Pencil, Percent, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { INVESTMENT_TYPES, labelOf } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { BankAccountOption } from "@/server/lookups";
import { RecordDocuments } from "@/features/finance/assets/fixed/components/record-documents";
import { archiveInvestment, attachInvestmentDocuments, removeInvestmentDocument, removeRedemption, restoreInvestment } from "../actions";
import type { InvestmentDetail } from "../types";
import { RedemptionDialog } from "./redemption-dialog";

function Row({ icon: Icon, label, children }: { icon: typeof Building2; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

const none = (text = "Not recorded") => <span className="text-muted-foreground">{text}</span>;

export function InvestmentDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </FormSheetBody>
  );
}

export function InvestmentDetailView({
  investment: v,
  accounts,
  canEdit,
  canDelete,
  onEdit,
  onChanged,
  onDelete,
}: {
  investment: InvestmentDetail;
  accounts: BankAccountOption[];
  /** These only hide controls; the actions check the same permissions on the server. */
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [redeeming, setRedeeming] = useState(false);
  const [busy, startTransition] = useTransition();

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
            <StatusBadge tone="info" dot={false}>
              {labelOf(INVESTMENT_TYPES, v.type)}
            </StatusBadge>
            {v.held ? <StatusBadge tone="success">Held</StatusBadge> : <StatusBadge tone="neutral">Redeemed</StatusBadge>}
            {v.archived ? <StatusBadge tone="neutral" dot={false}>Archived</StatusBadge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{v.groupPath}</p>
          <div>
            <p className="text-xs text-muted-foreground">Cost (carried on the balance sheet)</p>
            <Money value={v.amount} exact className="block text-3xl font-semibold tracking-tight" />
          </div>
          {v.currentValue !== null && v.held ? (
            <p className="text-sm text-muted-foreground">
              Worth <Money value={v.currentValue} className="font-medium text-foreground" /> on {formatDate(v.valuedOn!)}
              {v.unrealised !== null ? (
                <>
                  {" "}
                  ({v.unrealised >= 0 ? "up " : "down "}
                  <Money value={Math.abs(v.unrealised)} tone={v.unrealised >= 0 ? "positive" : "negative"} />, not booked until redeemed)
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="divide-y rounded-xl border px-4">
          <Row icon={CalendarDays} label="Purchased">
            {formatDate(v.purchaseDate)}
          </Row>
          <Row icon={CircleDollarSign} label="Paid from">
            {v.account ? v.account.name : none("Held before the books started")}
          </Row>
          <Row icon={Building2} label="Institution">
            {v.institution ?? none()}
            {v.reference ? <span className="block font-mono text-xs text-muted-foreground">{v.reference}</span> : null}
          </Row>
          <Row icon={Percent} label="Interest">
            {v.interestRate !== null ? `${formatNumber(v.interestRate)}% a year` : none()}
          </Row>
          <Row icon={CalendarDays} label="Matures">
            {v.maturityDate ? formatDate(v.maturityDate) : none("No maturity date")}
          </Row>
          <Row icon={LineChart} label="Current value">
            {v.currentValue !== null ? (
              <>
                <Money value={v.currentValue} /> <span className="text-muted-foreground">on {formatDate(v.valuedOn!)}</span>
              </>
            ) : (
              none("No value recorded. Edit to add one from a statement.")
            )}
          </Row>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Redemption</h3>
          {v.redemption ? (
            <div className="space-y-3 rounded-xl border p-4">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Date</dt>
                  <dd>{formatDate(v.redemption.date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Received</dt>
                  <dd>
                    <Money value={v.redemption.amount} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Cost</dt>
                  <dd>
                    <Money value={v.amount} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{v.redemption.gain >= 0 ? "Gain" : "Loss"}</dt>
                  <dd>
                    <Money value={Math.abs(v.redemption.gain)} tone={v.redemption.gain >= 0 ? "positive" : "negative"} />
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                {v.redemption.amount > 0 ? `Received into ${v.redemption.account?.name ?? "the default bank account"}.` : "Nothing received."}
                {v.redemption.notes ? ` ${v.redemption.notes}` : ""}
              </p>
              {!v.archived && (canEdit || canDelete) ? (
                <div className="flex flex-wrap gap-2">
                  {canEdit ? (
                    <Button size="sm" variant="outline" onClick={() => setRedeeming(true)}>
                      <Pencil /> Edit redemption
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <ConfirmDialog
                      title="Take this redemption back?"
                      description={`${v.name} returns to the books at cost, as if it was never redeemed.`}
                      confirmLabel="Take back"
                      destructive={false}
                      onConfirm={() => run(() => removeRedemption({ id: v.id }))}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Undo2 /> Take back
                        </Button>
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
              <p className="text-sm text-muted-foreground">Still held. Record a sale, maturity or withdrawal when the money comes back.</p>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setRedeeming(true)}>
                  Record redemption
                </Button>
              ) : null}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Documents</h3>
          <RecordDocuments
            documents={v.documents}
            canAttach={canEdit}
            canRemove={canDelete}
            attach={(fileIds) => attachInvestmentDocuments({ id: v.id, fileIds })}
            remove={(fileId) => removeInvestmentDocument({ id: v.id, fileId })}
            onChanged={onChanged}
            hint="FD receipt, statement, certificate"
          />
        </section>

        {v.notes ? (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{v.notes}</p>
          </section>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Added {formatDateTime(v.createdAt)}
          {v.createdBy ? ` by ${v.createdBy.name}` : ""}
          {v.updatedAt !== v.createdAt ? ` · updated ${formatDateTime(v.updatedAt)}` : ""}
        </p>
      </FormSheetBody>
      <FormSheetFooter>
        {canDelete ? (
          <ConfirmDialog
            title={`Delete ${v.name}?`}
            description="The investment and its documents are removed, and the balance sheet no longer counts it. Archiving after a redemption keeps the history instead."
            onConfirm={onDelete}
            trigger={
              <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                <Trash2 /> Delete
              </Button>
            }
          />
        ) : null}
        {v.redemption && canEdit ? (
          v.archived ? (
            <Button variant="outline" disabled={busy} onClick={() => run(() => restoreInvestment({ id: v.id }))}>
              <ArchiveRestore /> Restore
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => run(() => archiveInvestment({ id: v.id }))}>
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
      {redeeming ? <RedemptionDialog investment={v} accounts={accounts} open onOpenChange={setRedeeming} onSaved={onChanged} /> : null}
    </>
  );
}
