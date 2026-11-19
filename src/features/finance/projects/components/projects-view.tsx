"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition, startTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Eye, FolderKanban, LayoutGrid, MoreHorizontal, Pencil, Plus, Rows3, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { useIsAdmin } from "@/components/current-user";
import { PROJECT_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatPercent } from "@/lib/format";
import { deleteProject, setProjectStatus } from "../actions";
import { PROJECT_SORTS } from "../schemas";
import { BUDGET_TEXT_CLASS, budgetTone, deadlineLabel } from "../utils";
import type { ProjectRow } from "../types";
import { BudgetBar } from "./project-budget-bar";
import { ProjectCard } from "./project-card";
import { ProjectSheet } from "./project-sheet";

type Layout = "grid" | "table";

function linkedTotal(p: ProjectRow) {
  return p.links.expenses + p.links.income + p.links.allocations + p.links.tasks + p.links.schedules;
}

function linkSummary(p: ProjectRow) {
  const parts = [
    p.links.expenses && `${p.links.expenses} expense${p.links.expenses === 1 ? "" : "s"}`,
    p.links.income && `${p.links.income} income record${p.links.income === 1 ? "" : "s"}`,
    p.links.allocations && `${p.links.allocations} inventory assignment${p.links.allocations === 1 ? "" : "s"}`,
    p.links.tasks && `${p.links.tasks} task${p.links.tasks === 1 ? "" : "s"}`,
    p.links.schedules && `${p.links.schedules} active or paused recurring schedule${p.links.schedules === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  return parts.join(", ");
}

/** The projects list: grid or table, filters, and the create / edit drawer driven by ?new=1 and ?edit=<id>. */
export function ProjectsView({
  rows: serverRows,
  editTarget,
  clients,
  layout,
  hasAny,
}: {
  rows: ProjectRow[];
  /** The project named by ?edit=<id>, loaded even when filters hide it from the list. */
  editTarget: ProjectRow | null;
  clients: string[];
  layout: Layout;
  hasAny: boolean;
}) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, removeRow] = useOptimistic(serverRows, (state, id: string) => state.filter((r) => r.id !== id));
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "all";
  const sort = searchParams.get("sort") ?? "newest";
  const [search, setSearch] = useState(q);

  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const sheetOpen = searchParams.get("new") === "1" || Boolean(searchParams.get("edit"));
  const editing = searchParams.get("edit") ? editTarget : null;
  const closeSheet = () => update({ new: null, edit: null });

  async function remove(project: ProjectRow) {
    startTransition(() => removeRow(project.id));
    const result = await deleteProject({ id: project.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${project.name} deleted`);
    emitDataChanged();
    return true;
  }

  const columns = useMemo<ColumnDef<ProjectRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Project" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => (
          <Link href={`/finance/projects/${row.original.id}`} className="flex min-w-48 items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: row.original.color }} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium hover:underline">{row.original.name}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{row.original.code}</span>
            </span>
          </Link>
        ),
        enableHiding: false,
      },
      {
        id: "client",
        accessorFn: (r) => r.client ?? "",
        meta: { label: "Client" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Client" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.client ?? "-"}</span>,
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <ProjectStatusBadge status={row.original.status} />,
      },
      {
        id: "budget",
        accessorKey: "budget",
        meta: { label: "Budget", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Budget" align="right" />,
        cell: ({ row }) => <Money value={row.original.budget} />,
      },
      {
        id: "spent",
        accessorKey: "spent",
        meta: { label: "Spent", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Spent" align="right" />,
        cell: ({ row }) => <Money value={row.original.spent} className="font-medium" />,
      },
      {
        id: "remaining",
        accessorKey: "remaining",
        meta: { label: "Remaining", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Remaining" align="right" />,
        cell: ({ row }) => <Money value={row.original.remaining} tone={row.original.remaining < 0 ? "negative" : undefined} />,
      },
      {
        id: "usage",
        accessorKey: "usage",
        meta: { label: "Used" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Used" />,
        cell: ({ row }) => {
          const tone = budgetTone(row.original.usage, row.original.budget);
          return (
            <div className="flex min-w-28 items-center gap-2">
              <BudgetBar spent={row.original.spent} budget={row.original.budget} />
              <span className={cn("tabular w-12 shrink-0 text-right text-xs", BUDGET_TEXT_CLASS[tone])}>
                {row.original.budget > 0 ? formatPercent(row.original.usage) : "-"}
              </span>
            </div>
          );
        },
      },
      {
        id: "endDate",
        accessorFn: (r) => r.endDate ?? "",
        meta: { label: "End date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="End date" />,
        cell: ({ row }) => {
          const d = deadlineLabel(row.original.endDate, row.original.status);
          return row.original.endDate ? (
            <div className="whitespace-nowrap">
              <p className="text-sm">{formatDate(row.original.endDate)}</p>
              {d ? <p className={cn("text-xs", d.late ? "text-danger" : "text-muted-foreground")}>{d.text}</p> : null}
            </div>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem asChild>
                  <Link href={`/finance/projects/${row.original.id}`}>
                    <Eye /> Open
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => update({ edit: row.original.id, new: null })}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                {isAdmin ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row.original)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, isAdmin],
  );

  const filtered = q !== "" || status !== "all";
  const newButton = (
    <Button onClick={() => update({ new: "1", edit: null })}>
      <Plus /> New project
    </Button>
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <InputGroup className="h-9 sm:max-w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or client" aria-label="Search projects" />
          {search ? (
            <InputGroupAddon align="inline-end">
              <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <Select value={status} onValueChange={(v) => update({ status: v === "all" ? null : v })}>
          <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => update({ sort: v === "newest" ? null : v })}>
          <SelectTrigger className="h-9 w-full sm:w-52" aria-label="Sort projects">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          variant="outline"
          value={layout}
          onValueChange={(v) => v && update({ layout: v === "grid" ? null : v })}
          className="sm:ml-auto"
          aria-label="Layout"
        >
          <ToggleGroupItem value="grid" aria-label="Card grid" className="h-9 px-3">
            <LayoutGrid /> <span className="hidden sm:inline">Cards</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table" className="h-9 px-3">
            <Rows3 /> <span className="hidden sm:inline">Table</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {rows.length === 0 ? (
        filtered && hasAny ? (
          <EmptyState
            icon={Search}
            title="No projects match"
            description="Try a different search or clear the status filter."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  update({ q: null, status: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to set a budget, then log expenses and assign stock against it."
            action={newButton}
          />
        )
      ) : layout === "table" ? (
        <DataTable
          id="projects"
          columns={columns}
          data={rows}
          hideToolbar
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/finance/projects/${r.id}`)}
          renderMobileRow={(p) => (
            <div className="min-w-0 space-y-2">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 h-9 w-1 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{p.code}</span>
                    {p.client ? ` · ${p.client}` : ""}
                  </p>
                </div>
                <ProjectStatusBadge status={p.status} />
              </div>
              <div className="flex items-baseline justify-between gap-3 pl-4 text-sm">
                <span className="tabular min-w-0 truncate">
                  <Money value={p.spent} compact className="font-semibold" />
                  <span className="text-muted-foreground"> of </span>
                  <Money value={p.budget} compact className="text-muted-foreground" />
                </span>
                <span className={cn("tabular shrink-0 text-xs font-medium", BUDGET_TEXT_CLASS[budgetTone(p.usage, p.budget)])}>
                  {p.budget > 0 ? formatPercent(p.usage) : "No budget"}
                </span>
              </div>
              <div className="pl-4">
                <BudgetBar spent={p.spent} budget={p.budget} />
              </div>
            </div>
          )}
          initialHidden={["client"]}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {rows.map((p, i) => (
              <ProjectCard key={p.id} project={p} index={i} onEdit={() => update({ edit: p.id, new: null })} onDelete={isAdmin ? () => setDeleting(p) : undefined} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <ProjectSheet
        open={sheetOpen && (!searchParams.get("edit") || editing !== null)}
        project={editing}
        clients={clients}
        onClose={closeSheet}
        onDone={(id, created) => {
          closeSheet();
          if (created) router.push(`/finance/projects/${id}`);
        }}
      />

      {deleting && linkedTotal(deleting) === 0 ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title="Delete this project?"
          description={`${deleting.name} (${deleting.code}), its team list and any documents uploaded to it will be removed. This cannot be undone.`}
          onConfirm={() => remove(deleting)}
        />
      ) : null}
      {deleting && linkedTotal(deleting) > 0 ? <BlockedDeleteDialog project={deleting} onClose={() => setDeleting(null)} /> : null}
    </>
  );
}

/** Explains why a project with records cannot be deleted and offers to close it instead. */
function BlockedDeleteDialog({ project, onClose }: { project: ProjectRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<"completed" | "cancelled" | null>(null);

  function close(next: "completed" | "cancelled") {
    setTarget(next);
    startTransition(async () => {
      const result = await setProjectStatus({ id: project.id, status: next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${project.name} marked ${next}`);
      emitDataChanged();
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This project cannot be deleted</DialogTitle>
          <DialogDescription>
            {project.name} has {linkSummary(project)}. Deleting it would break your expense, stock and task history. Close it instead and it
            stays available for reports.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Keep as is
          </Button>
          <Button variant="outline" onClick={() => close("cancelled")} disabled={pending || project.status === "cancelled"}>
            {pending && target === "cancelled" ? <Spinner /> : null}
            Mark cancelled
          </Button>
          <Button onClick={() => close("completed")} disabled={pending || project.status === "completed"}>
            {pending && target === "completed" ? <Spinner /> : null}
            Mark completed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
