"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Banknote, History, Landmark, MoreHorizontal, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { useCan } from "@/components/current-user";
import { cn } from "@/lib/utils";
import { archiveBankAccount, fetchBankAccount, restoreBankAccount } from "../actions";
import type { AccountOption, AccountRow, BankAccountDetail } from "../types";
import { AccountForm } from "./account-form";
import { TransferDialog } from "./transfer-dialog";

type Panel = { kind: "new" } | { kind: "edit"; id: string } | { kind: "transfer" } | null;

/** Replaces some query params, keeping the rest (the history filter, for one). */
function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return {
    searchParams,
    set(updates: Record<string, string | null>) {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
  };
}

function AccountCard({
  account,
  canEdit,
  onEdit,
  onArchive,
  onRestore,
  historyHref,
}: {
  account: AccountRow;
  /** Cash & bank edit: shows Edit, Archive and Restore. */
  canEdit: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  historyHref: string;
}) {
  const Icon = account.kind === "cash" ? Banknote : Landmark;
  const fallback = !account.id;
  const details = [account.bankName, account.accountLast4 ? `ending ${account.accountLast4}` : null, account.ifsc].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-card",
        fallback && "border-warning/40 bg-warning/5",
        account.archived && "opacity-75",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", fallback ? "bg-warning/15 text-warning" : "bg-brand/12 text-brand-ink")}>
          {fallback ? <TriangleAlert className="size-4" /> : <Icon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">{fallback ? "Records that name no account, with no account set up for them" : details || (account.kind === "cash" ? "Cash in hand" : "Bank account")}</p>
        </div>
        {account.id ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${account.name} actions`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="truncate text-xs">{account.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={historyHref} scroll={false}>
                  <History /> Transactions
                </Link>
              </DropdownMenuItem>
              {canEdit ? (
                <>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {account.archived ? (
                    <DropdownMenuItem onSelect={onRestore}>
                      <ArchiveRestore /> Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={onArchive}>
                      <Archive /> Archive
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Balance today</p>
        <Money value={account.balance} tone="auto" className="text-xl font-semibold tracking-tight" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={account.kind === "cash" ? "success" : "info"} dot={false} className="h-5 px-2 text-[11px]">
          {account.kind === "cash" ? "Cash" : "Bank"}
        </StatusBadge>
        {account.archived ? (
          <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
            Archived
          </StatusBadge>
        ) : null}
        {account.defaultFor.map((m) => (
          <StatusBadge key={m} tone="brand" dot={false} className="h-5 px-2 text-[11px]">
            Default: {labelOf(PAYMENT_METHODS, m)}
          </StatusBadge>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        {account.openingDate ? (
          <span>
            Opening <Money value={account.openingBalance} className="text-foreground" /> on {formatDate(fromDateInput(account.openingDate))}
          </span>
        ) : (
          <span>No opening balance</span>
        )}
        <Link href={historyHref} scroll={false} className="font-medium text-brand-ink hover:underline">
          Transactions
        </Link>
      </div>
    </div>
  );
}

/**
 * The account cards with their add / edit drawer, archive confirmation and the transfer dialog.
 * The drawer and dialog follow the URL (?new=1, ?edit=<id>, ?transfer=1).
 */
export function AccountsGrid({ accounts, transferAccounts }: { accounts: AccountRow[]; transferAccounts: AccountOption[] }) {
  const url = useUrlParams();
  const [detail, setDetail] = useState<BankAccountDetail | null>(null);
  const [archiving, setArchiving] = useState<AccountRow | null>(null);
  // These only hide controls; every action checks the same permission on the server.
  const canCreate = useCan("finance.cash_bank:create");
  const canEdit = useCan("finance.cash_bank:edit");

  const panel: Panel = useMemo(() => {
    if (url.searchParams.get("new") === "1") return canCreate ? { kind: "new" } : null;
    if (url.searchParams.get("transfer") === "1") return canCreate ? { kind: "transfer" } : null;
    const edit = url.searchParams.get("edit");
    return edit && canEdit ? { kind: "edit", id: edit } : null;
  }, [url.searchParams, canCreate, canEdit]);
  const setPanel = (next: Panel) =>
    url.set({
      new: next?.kind === "new" ? "1" : null,
      transfer: next?.kind === "transfer" ? "1" : null,
      edit: next?.kind === "edit" ? next.id : null,
    });

  const editId = panel?.kind === "edit" ? panel.id : null;
  if (!editId && detail) setDetail(null);
  useEffect(() => {
    if (!editId || detail?.id === editId) return;
    let cancelled = false;
    fetchBankAccount(editId).then((d) => {
      if (cancelled) return;
      if (!d) {
        toast.error("That account no longer exists.");
        setPanel(null);
        return;
      }
      setDetail(d);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Which account each method is the default of, leaving out the one being edited.
  const takenDefaults = useMemo(() => {
    const out: Record<string, string> = {};
    for (const a of accounts) if (a.id && a.id !== editId) for (const m of a.defaultFor) out[m] = a.name;
    return out;
  }, [accounts, editId]);

  const historyHref = (code: string) => {
    const next = new URLSearchParams(url.searchParams.toString());
    next.set("account", code);
    // Opening the history should not reopen a drawer or dialog left in the URL.
    for (const k of ["new", "edit", "transfer"]) next.delete(k);
    return `?${next.toString()}#history`;
  };

  async function archive(row: AccountRow, restore: boolean) {
    if (!row.id) return false;
    const result = restore ? await restoreBankAccount({ id: row.id }) : await archiveBankAccount({ id: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.message ?? "Saved");
    emitDataChanged();
    return true;
  }

  return (
    <>
      {accounts.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <AccountCard
              key={a.code}
              account={a}
              historyHref={historyHref(a.code)}
              canEdit={canEdit}
              onEdit={() => a.id && setPanel({ kind: "edit", id: a.id })}
              onArchive={() => setArchiving(a)}
              onRestore={() => void archive(a, true)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Landmark}
          title="No bank accounts or cash boxes yet"
          description="Add each bank account and the cash box with the balance it held on a starting day. Balances then follow every expense, income and transfer recorded against them."
          action={
            canCreate ? (
              <Button onClick={() => setPanel({ kind: "new" })}>
                <Plus /> Add account
              </Button>
            ) : undefined
          }
        />
      )}

      <FormSheet
        open={panel?.kind === "new" || panel?.kind === "edit"}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel?.kind === "edit" ? "Edit account" : "Add account"}
        description={panel?.kind === "edit" ? detail?.name : "A bank account or a cash box the company pays from and into."}
      >
        {panel?.kind === "new" ? (
          <AccountForm takenDefaults={takenDefaults} onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
        ) : panel?.kind === "edit" && detail?.id === panel.id ? (
          <AccountForm key={detail.id} account={detail} takenDefaults={takenDefaults} onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
        ) : panel?.kind === "edit" ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : null}
      </FormSheet>

      {transferAccounts.length >= 2 ? (
        <TransferDialog open={panel?.kind === "transfer"} onOpenChange={(o) => setPanel(o ? { kind: "transfer" } : null)} accounts={transferAccounts} />
      ) : panel?.kind === "transfer" ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPanel(null)}
          title="Add two accounts first"
          description="A transfer moves money between two of your own accounts, for example from the bank to the cash box. Add both accounts, then record the transfer."
          confirmLabel="Add account"
          destructive={false}
          onConfirm={() => {
            setPanel({ kind: "new" });
            return false;
          }}
        />
      ) : null}

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name ?? "this account"}?`}
        description={
          archiving ? (
            <>
              It leaves the &quot;Paid from&quot; and &quot;Received into&quot; pickers. Its history and balance stay.
              {archiving.defaultFor.length
                ? ` It stays the default for ${archiving.defaultFor.map((m) => labelOf(PAYMENT_METHODS, m)).join(", ")}, so records without an account keep landing here until you set another default.`
                : null}
            </>
          ) : undefined
        }
        confirmLabel="Archive"
        destructive={false}
        onConfirm={() => (archiving ? archive(archiving, false) : false)}
      />
    </>
  );
}
