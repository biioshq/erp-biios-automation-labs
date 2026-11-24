"use client";

import { useEffect, useMemo, useOptimistic, useState, startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { LayoutGrid, MoreHorizontal, Pencil, Plus, Rows3, Search, Trash2, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, useTableUrl, type FilterDef } from "@/components/data-table";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES } from "@/lib/constants";
import { dateOrNotSet } from "../format";
import { emitDataChanged } from "@/lib/events";
import { cn } from "@/lib/utils";
import { deleteEmployee } from "../actions";
import type { EmployeeRow, UserLinkOption } from "../types";
import { AllocationBar, DepartmentBadge, EmployeeAvatar, EmployeeStatusBadge, ProjectChip, employmentLabel } from "./employee-bits";
import { EmployeeSheet } from "./employee-sheet";

const FILTERS: FilterDef[] = [
  { key: "department", title: "Department", options: DEPARTMENTS.map((o) => ({ ...o })) },
  { key: "status", title: "Status", options: EMPLOYEE_STATUSES.map((o) => ({ ...o })) },
  { key: "employmentType", title: "Type", options: EMPLOYMENT_TYPES.map((o) => ({ ...o })) },
];

const MAX_CHIPS = 3;

function ProjectChips({ projects }: { projects: EmployeeRow["projects"] }) {
  if (!projects.length) return <span className="text-xs text-muted-foreground">No current project</span>;
  const shown = projects.slice(0, MAX_CHIPS);
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {shown.map((p) => (
        <ProjectChip key={p.id} name={p.name} color={p.color} className="max-w-[11rem]" />
      ))}
      {projects.length > MAX_CHIPS ? (
        <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs text-muted-foreground">+{projects.length - MAX_CHIPS}</span>
      ) : null}
    </div>
  );
}

/** The employees list: toolbar, cards or table, and the create / edit drawer. */
export function EmployeesView({ rows, users, hasAny }: { rows: EmployeeRow[]; users: UserLinkOption[]; hasAny: boolean }) {
  const router = useRouter();
  const canDelete = useCan("finance.employees:delete");
  const canEdit = useCan("finance.employees:edit");
  const seesSalaries = useCan("data.salaries");
  const url = useTableUrl();
  const layout = url.get("layout") === "table" ? "table" : "cards";
  const [people, removePerson] = useOptimistic(rows, (state, id: string) => state.filter((r) => r.id !== id));
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null);

  const [search, setSearch] = useState(url.get("q") ?? "");
  useEffect(() => {
    if ((url.get("q") ?? "") === search) return;
    const handle = window.setTimeout(() => url.set({ q: search || null }), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = Boolean(search) || FILTERS.some((f) => url.getList(f.key).length > 0);
  const reset = () => {
    setSearch("");
    url.set({ q: null, ...Object.fromEntries(FILTERS.map((f) => [f.key, null])) });
  };

  async function remove(row: EmployeeRow) {
    startTransition(() => removePerson(row.id));
    const result = await deleteEmployee({ id: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${row.name} deleted`);
    emitDataChanged();
    return true;
  }

  const rowMenu = (row: EmployeeRow, triggerClass?: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`} className={cn("size-10 sm:size-8", triggerClass)}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/finance/employees/${row.id}`}>
            <UserRound /> View profile
          </Link>
        </DropdownMenuItem>
        {canEdit ? (
          <DropdownMenuItem asChild>
            <Link href={`?edit=${row.id}`} scroll={false}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns = useMemo<ColumnDef<EmployeeRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Employee" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Employee" />,
        cell: ({ row }) => (
          <div className="flex min-w-48 items-center gap-3">
            <EmployeeAvatar name={row.original.name} department={row.original.department} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-mono text-[11px]">{row.original.code}</span>
                {row.original.designation ? ` · ${row.original.designation}` : ""}
              </p>
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "department",
        accessorKey: "department",
        meta: { label: "Department" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
        cell: ({ row }) => <DepartmentBadge department={row.original.department} />,
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
      },
      {
        id: "projects",
        meta: { label: "Projects" },
        header: "Projects",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-44">
            <ProjectChips projects={row.original.projects} />
          </div>
        ),
      },
      {
        id: "allocationTotal",
        accessorKey: "allocationTotal",
        meta: { label: "Allocation" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Allocation" />,
        cell: ({ row }) => <AllocationBar value={row.original.allocationTotal} className="w-28" />,
      },
      ...(seesSalaries
        ? ([
            {
              id: "monthlySalary",
              accessorKey: "monthlySalary",
              meta: { label: "Monthly salary", align: "right" },
              header: ({ column }) => <DataTableColumnHeader column={column} title="Monthly salary" align="right" />,
              cell: ({ row }) => <Money value={row.original.monthlySalary} className="font-medium" />,
            },
          ] satisfies ColumnDef<EmployeeRow>[])
        : []),
      {
        id: "joinDate",
        accessorKey: "joinDate",
        meta: { label: "Joined" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Joined" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{dateOrNotSet(row.original.joinDate)}</span>,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            {rowMenu(row.original)}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canDelete, canEdit, seesSalaries],
  );

  const addButton = (
    <Button asChild>
      <Link href="?new=1" scroll={false}>
        <Plus /> Add your first employee
      </Link>
    </Button>
  );

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <InputGroup className="h-10 w-full sm:h-8 sm:w-64">
              <InputGroupAddon>
                <Search className="size-4" />
              </InputGroupAddon>
              <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, role, skill…" aria-label="Search employees" />
            </InputGroup>
            {FILTERS.map((f) => (
              <FacetedFilter key={f.key} title={f.title} options={f.options} selected={url.getList(f.key)} onChange={(v) => url.set({ [f.key]: v.length ? v : null })} />
            ))}
            {filtered ? (
              <Button variant="ghost" size="sm" onClick={reset} className="h-10 px-2 sm:h-8">
                Reset <X />
              </Button>
            ) : null}
          </div>
          <div className="inline-flex shrink-0 self-start rounded-lg border bg-card p-0.5" role="group" aria-label="Layout">
            <Button
              variant={layout === "cards" ? "secondary" : "ghost"}
              size="sm"
              className="h-10 px-3 sm:h-8"
              aria-pressed={layout === "cards"}
              onClick={() => url.set({ layout: null }, { resetPage: false })}
            >
              <LayoutGrid /> Cards
            </Button>
            <Button
              variant={layout === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-10 px-3 sm:h-8"
              aria-pressed={layout === "table"}
              onClick={() => url.set({ layout: "table" }, { resetPage: false })}
            >
              <Rows3 /> Table
            </Button>
          </div>
        </div>

        {!hasAny ? (
          <EmptyState
            icon={Users}
            title="No employees yet"
            description="Add the people who work with you. You can then put them on projects and pay their salary on a schedule."
            action={addButton}
          />
        ) : layout === "cards" ? (
          people.length ? (
            <ul className={cn("grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4", url.isPending && "opacity-60 transition-opacity")}>
              {people.map((p) => (
                <li key={p.id} className="min-w-0">
                  <article
                    className={cn(
                      "group/card relative flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-card transition-colors hover:border-foreground/20",
                      p.status === "exited" && "opacity-75",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <EmployeeAvatar name={p.name} department={p.department} size="md" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-semibold">
                          <Link href={`/finance/employees/${p.id}`} className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
                            {p.name}
                          </Link>
                        </h3>
                        <p className="truncate text-sm text-muted-foreground">{p.designation ?? employmentLabel(p.employmentType)}</p>
                      </div>
                      <div className="relative z-10 -mt-1 -mr-1.5">{rowMenu(p)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DepartmentBadge department={p.department} />
                      <EmployeeStatusBadge status={p.status} />
                    </div>
                    <div className="mt-auto space-y-2.5">
                      <ProjectChips projects={p.projects} />
                      <AllocationBar value={p.allocationTotal} />
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">{p.code}</p>
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={Search}
              title="No matching employees"
              description="Try a different search or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          )
        ) : (
          <DataTable
            id="employees"
            columns={columns}
            data={people}
            hideToolbar
            pageSize={20}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/finance/employees/${r.id}`)}
            renderMobileRow={(p) => (
              <div className="flex items-start gap-3">
                <EmployeeAvatar name={p.name} department={p.department} size="md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.designation ?? employmentLabel(p.employmentType)}</p>
                    </div>
                    <EmployeeStatusBadge status={p.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <DepartmentBadge department={p.department} />
                    <span className="tabular">
                      {p.projects.length} {p.projects.length === 1 ? "project" : "projects"} · {p.allocationTotal}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </div>

      <EmployeeSheet users={users} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this employee?"
        description={deleting ? `${deleting.name} (${deleting.code}) will be removed. This only works for people with no salary or project history.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
