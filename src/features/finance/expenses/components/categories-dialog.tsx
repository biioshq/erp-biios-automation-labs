"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Eye, EyeOff, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canDeleteExpenseCategory, canHideExpenseCategory, type ExpenseCategoryOption } from "@/lib/expense-categories";
import type { ActionResult } from "@/lib/action-result";
import type { ExpenseCategoryUsage } from "@/server/expense-categories";
import {
  addExpenseCategory,
  deleteExpenseCategoryAction,
  fetchExpenseCategoryUsage,
  renameExpenseCategoryAction,
  setExpenseCategoryHiddenAction,
  setExpenseCategoryNatureAction,
} from "../category-actions";
import { EXPENSE_NATURES, type ExpenseNature } from "@/lib/constants";

const usageText = (u: ExpenseCategoryUsage[string] | undefined) => {
  if (!u || (!u.expenses && !u.schedules && !u.liabilities)) return "Not used yet";
  const parts = [];
  if (u.expenses) parts.push(`${formatNumber(u.expenses)} ${u.expenses === 1 ? "expense" : "expenses"}`);
  if (u.schedules) parts.push(`${formatNumber(u.schedules)} ${u.schedules === 1 ? "schedule" : "schedules"}`);
  if (u.liabilities) parts.push(`${formatNumber(u.liabilities)} accrued ${u.liabilities === 1 ? "liability" : "liabilities"}`);
  return parts.join(" · ");
};

/** Why a category cannot be hidden, for the ones the app relies on. */
const SYSTEM_NOTE: Record<string, string> = {
  inventory: "Used for stock assigned to projects",
  salaries: "Only admins see these payments",
};

/** "Categories" in the Expenses header (admins only): add, rename, hide and delete expense categories. */
export function ExpenseCategoriesButton({ categories }: { categories: ExpenseCategoryOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Tags /> Categories
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Expense categories</DialogTitle>
            <DialogDescription>
              A new name shows on every expense that uses the category. Hidden categories are not offered for new expenses; older ones keep
              them. Direct or indirect decides how overheads are classed: an expense on a project is always direct.
            </DialogDescription>
          </DialogHeader>
          {open ? <CategoriesManager categories={categories} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CategoriesManager({ categories }: { categories: ExpenseCategoryOption[] }) {
  const router = useRouter();
  const [usage, setUsage] = useState<ExpenseCategoryUsage | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ value: string; label: string; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ExpenseCategoryOption | null>(null);
  const [, startTransition] = useTransition();

  const loadUsage = () => {
    void fetchExpenseCategoryUsage({}).then((r) => {
      if (r.ok) setUsage(r.data);
    });
  };
  useEffect(loadUsage, []);

  /** Runs one change; the page refreshes with the new list when it succeeds. */
  const run = <R,>(key: string, call: () => Promise<ActionResult<R>>, success: string, after?: () => void) => {
    setBusy(key);
    startTransition(async () => {
      const result = await call();
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        if (key === "new") setNewError(result.fieldErrors?.label?.[0] ?? result.error);
        if (editing && key === `rename:${editing.value}`) setEditing({ ...editing, error: result.fieldErrors?.label?.[0] ?? result.error });
        return;
      }
      toast.success(success);
      after?.();
      emitDataChanged();
      router.refresh();
      loadUsage();
    });
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) {
      setNewError("Name is required");
      return;
    }
    setNewError(null);
    run("new", () => addExpenseCategory({ label }), `${label} added`, () => setNewLabel(""));
  };

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) {
      setEditing({ ...editing, error: "Name is required" });
      return;
    }
    run(`rename:${editing.value}`, () => renameExpenseCategoryAction({ value: editing.value, label }), `Renamed to ${label}`, () => setEditing(null));
  };

  return (
    <>
      <form onSubmit={add} noValidate className="space-y-1.5">
        <label htmlFor="new-category" className="text-[13px] font-medium">
          New category
        </label>
        <div className="flex gap-2">
          <Input
            id="new-category"
            value={newLabel}
            onChange={(e) => {
              setNewLabel(e.target.value);
              if (newError) setNewError(null);
            }}
            placeholder="Site visits"
            maxLength={60}
            aria-invalid={newError ? true : undefined}
            aria-describedby={newError ? "new-category-error" : undefined}
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={busy === "new"} className="shrink-0">
            {busy === "new" ? <Spinner /> : <Plus />} Add
          </Button>
        </div>
        {newError ? (
          <p id="new-category-error" className="text-xs text-destructive">
            {newError}
          </p>
        ) : null}
      </form>

      <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border px-1" aria-label="Expense categories">
        {categories.map((c) => {
          const used = usage?.[c.value];
          const inUse = Boolean(used && (used.expenses || used.schedules || used.liabilities));
          const isEditing = editing?.value === c.value;
          const rowBusy = busy !== null && busy.endsWith(`:${c.value}`);
          return (
            <li key={c.value} className={cn("flex min-h-12 items-center gap-2 px-2 py-2", c.hidden && !isEditing && "text-muted-foreground")}>
              {isEditing ? (
                <form onSubmit={saveRename} noValidate className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      value={editing.label}
                      onChange={(e) => setEditing({ ...editing, label: e.target.value, error: undefined })}
                      maxLength={60}
                      aria-label={`New name for ${c.label}`}
                      aria-invalid={editing.error ? true : undefined}
                      className="h-8 min-w-0 flex-1"
                    />
                    <Button type="submit" size="icon-sm" aria-label="Save name" disabled={rowBusy}>
                      {rowBusy ? <Spinner /> : <Check />}
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel rename" onClick={() => setEditing(null)} disabled={rowBusy}>
                      <X />
                    </Button>
                  </div>
                  {editing.error ? <p className="text-xs text-destructive">{editing.error}</p> : null}
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className={cn("truncate text-sm font-medium", c.hidden ? "text-muted-foreground" : "text-foreground")}>{c.label}</span>
                      {c.hidden ? (
                        <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                          Hidden
                        </StatusBadge>
                      ) : null}
                      {!c.builtIn ? (
                        <StatusBadge tone="info" dot={false} className="h-5 px-2 text-[11px]">
                          Added
                        </StatusBadge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {usage ? usageText(used) : "Counting records…"}
                      {SYSTEM_NOTE[c.value] ? ` · ${SYSTEM_NOTE[c.value]}` : ""}
                    </p>
                    {/* Said in the row, not a tooltip, so it also reaches people on phones. */}
                    {canDeleteExpenseCategory(c) && inUse ? (
                      <p id={`category-note-${c.value}`} className="text-xs text-muted-foreground">
                        In use, so it cannot be deleted. Hide it instead.
                      </p>
                    ) : null}
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      spacing={0}
                      value={c.nature}
                      disabled={busy !== null}
                      onValueChange={(v) => {
                        if (!v || v === c.nature) return;
                        const nature = v as ExpenseNature;
                        run(
                          `nature:${c.value}`,
                          () => setExpenseCategoryNatureAction({ value: c.value, nature }),
                          `${c.label} is now ${nature === "direct" ? "a direct cost" : "an indirect cost"}`,
                        );
                      }}
                      aria-label={`${c.label}: direct or indirect`}
                      className="mt-1.5"
                    >
                      {EXPENSE_NATURES.map((n) => (
                        <ToggleGroupItem
                          key={n.value}
                          value={n.value}
                          className="h-6 px-2.5 text-[11px] max-md:h-8 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink"
                        >
                          {n.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Rename ${c.label}`}
                      disabled={busy !== null}
                      onClick={() => setEditing({ value: c.value, label: c.label })}
                    >
                      <Pencil />
                    </Button>
                    {canHideExpenseCategory(c.value) ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={c.hidden ? `Show ${c.label}` : `Hide ${c.label}`}
                        title={c.hidden ? "Show in pickers again" : "Hide from pickers"}
                        disabled={busy !== null}
                        onClick={() =>
                          run(
                            `hide:${c.value}`,
                            () => setExpenseCategoryHiddenAction({ value: c.value, hidden: !c.hidden }),
                            c.hidden ? `${c.label} is offered again` : `${c.label} hidden`,
                          )
                        }
                      >
                        {busy === `hide:${c.value}` ? <Spinner /> : c.hidden ? <Eye /> : <EyeOff />}
                      </Button>
                    ) : (
                      <span className="size-7 max-md:size-10" aria-hidden />
                    )}
                    {canDeleteExpenseCategory(c) ? (
                      inUse ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${c.label}`}
                          aria-describedby={`category-note-${c.value}`}
                          disabled
                        >
                          <Trash2 />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${c.label}`}
                          className="text-destructive hover:text-destructive"
                          disabled={busy !== null || usage === null}
                          onClick={() => setDeleting(c)}
                        >
                          {busy === `delete:${c.value}` ? <Spinner /> : <Trash2 />}
                        </Button>
                      )
                    ) : (
                      <span className="size-7 max-md:size-10" aria-hidden />
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.label}?` : "Delete category?"}
        description="No expense or schedule uses it, so nothing else changes."
        onConfirm={async () => {
          if (!deleting) return;
          const c = deleting;
          const result = await deleteExpenseCategoryAction({ value: c.value });
          if (!result.ok) {
            toast.error(result.error);
            loadUsage();
            return;
          }
          toast.success(`${c.label} deleted`);
          emitDataChanged();
          router.refresh();
          loadUsage();
        }}
      />
    </>
  );
}
