"use client";

import Link from "next/link";
import { CalendarDays, CreditCard, FileText, Hash, Landmark, Pencil, Trash2, User, Vault, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { FileTile } from "@/features/files/components/file-preview";
import { INVESTOR_INSTRUMENTS, PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { ENTRY_TONES, HOLDER_KIND_LABELS, entryTypeLabel, isMoneyEntry } from "../labels";
import { BankLineLink } from "@/features/finance/bank-statements/components/bank-line-link";
import type { EntryDetail } from "../types";

function Row({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

const None = ({ children = "None recorded" }: { children?: React.ReactNode }) => <span className="text-muted-foreground">{children}</span>;

export function DetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </FormSheetBody>
  );
}

/** What an entry does to the books, in one sentence. */
function effectNote(entry: EntryDetail): string {
  switch (entry.type) {
    case "capital":
      return `Adds to ${entry.holder?.kind === "investor" ? "investors'" : "owner's"} capital and to the account it was received into. It is not income.`;
    case "drawing":
      return "Reduces the owner's capital and the account it was paid from. It is not an expense.";
    case "dividend":
      return "Paid out of retained earnings. It is not an expense.";
    case "reserve_transfer":
      return "Moves this amount from retained earnings into the reserve. Total equity does not change and no money moves.";
    case "opening_retained":
      return "The retained earnings carried in from before the books started, moved out of opening balance equity. Total equity does not change.";
  }
}

/** Read-only view of a capital entry with its documents. */
export function EntryDetailView({ entry, onEdit, onDelete }: { entry: EntryDetail; onEdit: () => void; onDelete: () => Promise<boolean> }) {
  const holderHref = entry.holder ? `${HOLDER_KIND_LABELS[entry.holder.kind].href}?holder=${entry.holder.id}` : null;
  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{entry.number}</span>
            <StatusBadge tone={ENTRY_TONES[entry.type]} dot={false}>
              {entryTypeLabel(entry.type)}
            </StatusBadge>
            {entry.type === "capital" && entry.initial !== null ? (
              <StatusBadge tone="neutral" dot={false}>
                {entry.initial ? "Initial" : "Additional"}
              </StatusBadge>
            ) : null}
          </div>
          <Money value={entry.amount} exact className="block text-3xl font-semibold tracking-tight" />
          <p className="text-sm text-muted-foreground">{effectNote(entry)}</p>
        </div>

        <div className="divide-y rounded-xl border px-4">
          {entry.type === "capital" || entry.type === "drawing" || entry.type === "dividend" ? (
            <Row icon={User} label={entry.type === "dividend" ? "Paid to" : entry.holder?.kind === "investor" ? "Investor" : "Owner"}>
              {entry.holder && holderHref ? (
                <Link href={holderHref} className="font-medium hover:underline">
                  {entry.holder.name}
                </Link>
              ) : (
                <None>{entry.type === "dividend" ? "All shareholders" : "Not recorded"}</None>
              )}
            </Row>
          ) : null}
          <Row icon={CalendarDays} label={entry.type === "opening_retained" ? "As of" : "Date"}>
            {formatDate(entry.date)}
          </Row>
          {entry.instrument ? (
            <Row icon={Landmark} label="Investment type">
              {labelOf(INVESTOR_INSTRUMENTS, entry.instrument)}
            </Row>
          ) : null}
          {entry.reserveGroup ? (
            <Row icon={Vault} label="Reserve">
              <Link href="/finance/equity/reserves" className="font-medium hover:underline">
                {entry.reserveGroup.label}
              </Link>
            </Row>
          ) : null}
          {isMoneyEntry(entry.type) ? (
            <>
              <Row icon={CreditCard} label="Payment mode">
                {entry.paymentMethod ? labelOf(PAYMENT_METHODS, entry.paymentMethod) : <None>Bank transfer (not recorded)</None>}
              </Row>
              <Row icon={Wallet} label={entry.type === "capital" ? "Received into" : "Paid from"}>
                {entry.account ? (
                  <Link href="/finance/assets/cash" className="hover:underline">
                    {entry.account.name}
                  </Link>
                ) : entry.paymentMethod === "biios_startup_llp" ? (
                  "Through Biios Startup LLP"
                ) : (
                  <None>Default account for this mode</None>
                )}
              </Row>
            </>
          ) : null}
          <Row icon={Hash} label="Reference">
            {entry.reference ? <span className="font-mono text-[13px]">{entry.reference}</span> : <None />}
          </Row>
          {entry.purpose ? (
            <Row icon={FileText} label={entry.type === "drawing" ? "Purpose" : "Reason"}>
              {entry.purpose}
            </Row>
          ) : null}
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Supporting documents</h3>
          {entry.files.length ? (
            <div className="space-y-2">
              {entry.files.map((f) => (
                <FileTile key={f.id} file={f} />
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <FileText className="size-4" /> No documents uploaded.
            </p>
          )}
        </section>

        {entry.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{entry.notes}</p>
          </section>
        ) : null}

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {entry.fromBankStatement ? "Created from, or matched to, a bank statement line. " : ""}
            Recorded {formatDateTime(entry.createdAt)}
            {entry.createdBy ? ` by ${entry.createdBy.name}` : ""}
            {entry.updatedAt !== entry.createdAt ? ` · updated ${formatDateTime(entry.updatedAt)}` : ""}
          </p>
          <BankLineLink id={entry.bankTransactionId} />
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <ConfirmDialog
          title="Delete this entry?"
          description={
            <>
              {entry.number} ({entryTypeLabel(entry.type).toLowerCase()}, {formatDate(entry.date)}) and its documents will be removed. Equity, cash and the balance sheet change at once.
              {entry.fromBankStatement
                ? " The bank statement line stays on its statement, shown as “Linked record was deleted”, and can be reviewed and added again there. To keep the entry and only untie it from the line, unmatch the line in Bank statements instead."
                : ""}
            </>
          }
          onConfirm={onDelete}
          trigger={
            <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
              <Trash2 /> Delete
            </Button>
          }
        />
        <Button onClick={onEdit}>
          <Pencil /> Edit
        </Button>
      </FormSheetFooter>
    </>
  );
}
