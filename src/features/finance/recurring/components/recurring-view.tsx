"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Eye, MoreHorizontal, Pencil, Plus, Repeat, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { useOnLiveChange } from "@/components/live-updates";
import { cn } from "@/lib/utils";
import { RECURRING_FREQUENCIES, RECURRING_STATUSES, labelOf } from "@/lib/constants";
import { DEFAULT_EXPENSE_CATEGORIES, expenseCategoryFilterOptions, type ExpenseCategoryOption } from "@/lib/expense-categories";
import { formatDate } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { Paginated } from "@/lib/list-params";
import type { EmployeeOption, ProjectOption } from "@/server/lookups";
import { deleteRecurring, fetchRecurring, postRecurringNow, setRecurringStatus } from "../actions";
import { dueInfo, rhythmLabel, type DueInfo } from "../format";
import { RECURRING_GROUPS, RECURRING_TEMPLATES } from "../schemas";
import type { PostedResult, RecurringDetail, RecurringRow, RecurringSummary } from "../types";
import { CategoryBadge, RecurringStatusBadge } from "./badges";
import { RecurringDetailSkeleton, RecurringDetailView } from "./recurring-detail";
import { RecurringForm } from "./recurring-form";

type Panel = { kind: "new" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | null;

const DUE_CLASS: Record<DueInfo["tone"], string> = {
  today: "bg-brand/15 text-foreground font-medium",
  overdue: "bg-warning/12 text-warning font-medium",
  soon: "text-foreground font-medium",
  later: "text-foreground",
  idle: "text-muted-foreground",
};

function DueCell({ row }: { row: RecurringRow }) {
  const due = dueInfo(row.nextRunDate, row.status);
  return (
    <div className="min-w-28">
      <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-sm whitespace-nowrap", DUE_CLASS[due.tone], due.tone === "today" || due.tone === "overdue" ? "" : "-ml-1.5")}>
        {due.label}
      </span>
      <p className="tabular mt-0.5 text-xs text-muted-foreground">{row.status === "ended" ? (row.lastRunDate ? `Last ${formatDate(row.lastRunDate)}` : "Nothing posted") : formatDate(row.nextRunDate)}</p>
    </div>
  );
}

function AssigneeChip({ row }: { row: RecurringRow }) {
  if (row.employee)
    return (
      <span className="inline-flex max-w-44 items-center gap-1.5 truncate text-sm">
        <User className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{row.employee.name}</span>
      </span>
    );
  if (row.project)
    return (
      <span className="inline-flex max-w-44 items-center gap-1.5 text-sm">
        <span className="size-2 shrink-0 rounded-full" style={{ background: row.project.color }} />
        <span className="truncate">{row.project.name}</span>
      </span>
    );
  return <span className="text-xs text-muted-foreground">Overhead</span>;
}

/**
 * The recurring schedules list with its create / view / edit drawers. Drawers follow the URL
 * (?new=1, ?view=<id>, ?edit=<id>); ?template=<key> pre-fills the new form; ?group= is the tab.
 */
export function RecurringView({
  data,
  summary,
  projects,
  vendors,
  employees,
  categories = DEFAULT_EXPENSE_CATEGORIES,
}: {
  data: Paginated<RecurringRow>;
  summary: RecurringSummary;
  projects: ProjectOption[];
  vendors: string[];
  employees: EmployeeOption[];
  /** Built-in and custom categories, hidden ones included (getExpenseCategories). */
  categories?: ExpenseCategoryOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canCreate = useCan("finance.recurring:create");
  const canEdit = useCan("finance.recurring:edit");
  const canRemove = useCan("finance.recurring:delete");
  const [detail, setDetail] = useState<RecurringDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [version, setVersion] = useState(0);
  const [justPosted, setJustPosted] = useState<{ scheduleId: string; result: PostedResult } | null>(null);
  const [tabPending, startTab] = useTransition();

  const panel: Panel = useMemo(() => {
    // The forms open only with the create or edit permission; otherwise the read-only drawer.
    if (searchParams.get("new") === "1" && canCreate) return { kind: "new" };
    const edit = searchParams.get("edit");
    if (edit && canEdit) return { kind: "edit", id: edit };
    const view = searchParams.get("view") ?? (edit && !canEdit ? edit : null);
    if (view) return { kind: "view", id: view };
    return null;
  }, [searchParams, canCreate, canEdit]);
  const template = searchParams.get("template");
  const group = searchParams.get("group") ?? "all";

  const setPanel = (next: Panel, extra?: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    ["new", "view", "edit", "template"].forEach((k) => params.delete(k));
    if (next?.kind === "new") params.set("new", "1");
    if (next?.kind === "view") params.set("view", next.id);
    if (next?.kind === "edit") params.set("edit", next.id);
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setGroup = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("group");
    else params.set("group", value);
    params.delete("page");
    const qs = params.toString();
    startTab(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const panelId = panel && panel.kind !== "new" ? panel.id : null;
  // Closing the drawer drops the cached schedule, so the next open shows fresh data.
  if (!panelId && detail) setDetail(null);
  useEffect(() => {
    if (!panelId) return;
    if (detail?.id === panelId) return;
    let cancelled = false;
    setLoadingDetail(true);
    fetchRecurring(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That schedule no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .finally(() => !cancelled && setLoadingDetail(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, version]);

  // While the drawer only shows a schedule, someone else's change (or a posting) refreshes it in place. Never while
  // the edit form is open: that would drop what is being typed.
  const viewingId = panel?.kind === "view" ? panel.id : null;
  const viewing = useRef(viewingId);
  useEffect(() => {
    viewing.current = viewingId;
  }, [viewingId]);
  useOnLiveChange(() => {
    const id = viewing.current;
    // Still loading (first open or after reload()): that fetch brings the fresh schedule already.
    if (!id || detail?.id !== id) return;
    fetchRecurring(id)
      .then((d) => {
        if (viewing.current !== id) return;
        if (!d) {
          toast.error("That schedule no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .catch(() => {
        // Offline: the drawer keeps what it shows and the next change tries again.
      });
  });

  /** Refetch the open schedule after a change. */
  const reload = () => {
    setDetail(null);
    setVersion((v) => v + 1);
  };

  async function postNext(): Promise<boolean> {
    if (!detail) return false;
    const result = await postRecurringNow({ id: detail.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setJustPosted({ scheduleId: detail.id, result: result.data });
    toast.success(`${result.data.number} posted`);
    emitDataChanged();
    reload();
    return true;
  }

  async function changeStatus(action: "pause" | "resume" | "end"): Promise<boolean> {
    if (!detail) return false;
    const result = await setRecurringStatus({ id: detail.id, action });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success({ pause: "Schedule paused", resume: "Schedule resumed", end: "Schedule ended" }[action]);
    emitDataChanged();
    reload();
    return true;
  }

  async function remove(): Promise<boolean> {
    if (!detail) return false;
    const result = await deleteRecurring({ id: detail.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${detail.code} deleted`);
    // The live refresh below must not refetch the deleted schedule and report it missing.
    viewing.current = null;
    emitDataChanged();
    setDetail(null);
    setPanel(null);
    return true;
  }

  const columns = useMemo<ColumnDef<RecurringRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Schedule" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Schedule" />,
        cell: ({ row }) => (
          <div className="flex min-w-52 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-muted-foreground">
              <Repeat className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono">{row.original.code}</span> · {row.original.vendor}
              </p>
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "category",
        accessorKey: "category",
        meta: { label: "Category" },
        header: "Category",
        enableSorting: false,
        cell: ({ row }) => <CategoryBadge label={row.original.categoryLabel} />,
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => (
          <div className="text-right">
            <Money value={row.original.amount} className="font-semibold" />
            {row.original.gstRate > 0 ? <p className="text-[11px] text-muted-foreground">incl. {row.original.gstRate}% GST</p> : null}
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "frequency",
        accessorKey: "frequency",
        meta: { label: "Rhythm" },
        header: "Rhythm",
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm whitespace-nowrap text-muted-foreground">{rhythmLabel(row.original.frequency, row.original.dayOfMonth, row.original.startDate)}</span>,
      },
      {
        id: "nextRunDate",
        accessorKey: "nextRunDate",
        meta: { label: "Next due" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Next due" />,
        cell: ({ row }) => <DueCell row={row.original} />,
        enableHiding: false,
      },
      {
        id: "assignee",
        meta: { label: "Project / person" },
        header: "Project / person",
        enableSorting: false,
        cell: ({ row }) => <AssigneeChip row={row.original} />,
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <RecurringStatusBadge status={row.original.status} />,
      },
      {
        id: "occurrences",
        accessorKey: "occurrences",
        meta: { label: "Posted", align: "right" },
        header: () => <div className="text-right text-xs">Posted</div>,
        enableSorting: false,
        cell: ({ row }) => <div className="tabular text-right text-muted-foreground">{row.original.occurrences}</div>,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Schedule actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="font-mono text-xs">{row.original.code}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPanel({ kind: "view", id: row.original.id })}>
                  <Eye /> View
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem onSelect={() => setPanel({ kind: "edit", id: row.original.id })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, canEdit],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "category", title: "Category", options: expenseCategoryFilterOptions(categories, { includeInventory: false }) },
      { key: "status", title: "Status", options: RECURRING_STATUSES.map((o) => ({ ...o })) },
      { key: "frequency", title: "Frequency", options: RECURRING_FREQUENCIES.map((o) => ({ ...o })) },
      {
        key: "project",
        title: "Project",
        options: [{ value: "none", label: "No project (overhead)" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
      },
    ],
    [projects, categories],
  );

  const sheetOpen = panel !== null;
  const editing = panel?.kind === "edit";

  const emptyState = (
    <EmptyState
      icon={Repeat}
      title="No recurring expenses yet"
      description="A schedule posts the same expense on a rhythm, such as salaries, rent, internet and software subscriptions."
      action={
        canCreate ? (
          <div className="flex flex-wrap justify-center gap-2">
            {RECURRING_TEMPLATES.map((t) => (
              <Button key={t.key} variant="outline" onClick={() => setPanel({ kind: "new" }, { template: t.key })}>
                <Plus /> {t.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Someone with permission to add schedules can add the first one.</p>
        )
      }
    />
  );

  return (
    <>
      {summary.total > 0 ? (
        <div role="tablist" aria-label="Schedule groups" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {RECURRING_GROUPS.map((g) => {
            const active = group === g.value;
            return (
              <button
                key={g.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setGroup(g.value)}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors md:min-h-8",
                  active ? "border-foreground bg-foreground font-medium text-background" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  tabPending && "opacity-70",
                )}
              >
                {g.label}
                <span className={cn("tabular text-xs", active ? "text-background/70" : "text-muted-foreground")}>{summary.groupCounts[g.value] ?? 0}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <DataTable
        id="recurring"
        mode="server"
        columns={columns}
        data={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={filters}
        searchPlaceholder="Search name, vendor, code"
        getRowId={(r) => r.id}
        onRowClick={(r) => setPanel({ kind: "view", id: r.id })}
        // Project / person is hidden at first so Status and the actions fit the card; "Show all" brings it back.
        initialHidden={["occurrences", "assignee"]}
        emptyState={summary.total === 0 ? emptyState : undefined}
        renderMobileRow={(r) => (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">{r.vendor}</p>
              </div>
              <div className="shrink-0 text-right">
                <Money value={r.amount} className="font-semibold" />
                <p className="text-[11px] text-muted-foreground">{labelOf(RECURRING_FREQUENCIES, r.frequency).toLowerCase()}</p>
              </div>
            </div>
            <p className="truncate text-xs text-muted-foreground">{rhythmLabel(r.frequency, r.dayOfMonth, r.startDate)}</p>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <RecurringStatusBadge status={r.status} />
                <DueText row={r} />
              </div>
              <AssigneeChip row={r} />
            </div>
          </div>
        )}
      />

      <FormSheet
        open={sheetOpen}
        onOpenChange={(o) => !o && setPanel(null)}
        size={panel?.kind === "view" ? "md" : "lg"}
        title={panel?.kind === "new" ? "New schedule" : editing ? "Edit schedule" : (detail?.name ?? "Schedule")}
        description={
          panel?.kind === "new"
            ? "Post the same expense on a rhythm."
            : detail
              ? `${detail.code} · ${rhythmLabel(detail.frequency, detail.dayOfMonth, detail.startDate)}`
              : undefined
        }
      >
        {panel?.kind === "new" ? (
          <RecurringForm
            key={template ?? "blank"}
            template={template}
            projects={projects}
            vendors={vendors}
            employees={employees}
            categories={categories}
            onDone={(id) => setPanel({ kind: "view", id })}
            onCancel={() => setPanel(null)}
          />
        ) : panel && (loadingDetail || detail?.id !== panel.id) ? (
          <RecurringDetailSkeleton />
        ) : panel?.kind === "edit" && detail ? (
          <RecurringForm
            key={detail.id}
            schedule={detail}
            projects={projects}
            vendors={vendors}
            employees={employees}
            categories={categories}
            onDone={(id) => {
              setDetail(null);
              setPanel({ kind: "view", id });
              setVersion((v) => v + 1);
            }}
            onCancel={() => setPanel({ kind: "view", id: detail.id })}
          />
        ) : panel?.kind === "view" && detail ? (
          <RecurringDetailView
            schedule={detail}
            canEdit={canEdit}
            canRemove={canRemove}
            justPosted={justPosted?.scheduleId === detail.id ? justPosted.result : null}
            onEdit={() => setPanel({ kind: "edit", id: detail.id })}
            onPostNext={postNext}
            onSetStatus={changeStatus}
            onDelete={remove}
          />
        ) : null}
      </FormSheet>
    </>
  );
}

function DueText({ row }: { row: RecurringRow }) {
  const due = dueInfo(row.nextRunDate, row.status);
  if (row.status !== "active") return <span className="text-xs text-muted-foreground">{row.status === "ended" ? "No more dates" : `Next ${formatDate(row.nextRunDate)}`}</span>;
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-xs", DUE_CLASS[due.tone])}>
      {due.label}
      <span className="font-normal text-muted-foreground"> · {formatDate(row.nextRunDate)}</span>
    </span>
  );
}
