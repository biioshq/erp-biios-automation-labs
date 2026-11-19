"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Columns3, Search, Table2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { useTableUrl, type FilterDef } from "@/components/data-table";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import type { ProjectOption } from "@/server/lookups";
import type { TeamMember } from "@/server/services/users";
import type { TaskView } from "../schemas";

/** Filter chips for the table, board and calendar. `hidden` drops filters a page fixes itself (status pages, My Tasks). */
export function buildTaskFilters({ projects, people, hidden }: { projects: ProjectOption[]; people: TeamMember[]; hidden: string[] }): FilterDef[] {
  const all: FilterDef[] = [
    { key: "status", title: "Status", options: [...TASK_STATUSES.map((o) => ({ ...o })), { value: "overdue", label: "Overdue" }] },
    { key: "priority", title: "Priority", options: TASK_PRIORITIES.map((o) => ({ ...o })) },
    {
      key: "project",
      title: "Project",
      options: [{ value: "none", label: "No project" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
    },
    {
      key: "assignee",
      title: "Assignee",
      options: [{ value: "none", label: "Unassigned" }, ...people.map((m) => ({ value: m.id, label: m.name }))],
    },
  ];
  return all.filter((f) => !hidden.includes(f.key));
}

const VIEWS: { value: TaskView; label: string; icon: typeof Table2 }[] = [
  { value: "table", label: "Table", icon: Table2 },
  { value: "board", label: "Board", icon: Columns3 },
  { value: "calendar", label: "Calendar", icon: CalendarDays },
];

/** Table / Board / Calendar switch, stored in ?view=. */
export function ViewSwitcher({ view }: { view: TaskView }) {
  const url = useTableUrl();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={view}
      onValueChange={(v) => v && v !== view && url.set({ view: v === "table" ? null : v, page: null, month: null, from: null, to: null, sort: null }, { resetPage: false })}
      aria-label="Choose a view"
    >
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem key={value} value={value} aria-label={`${label} view`} className="h-10 gap-1.5 px-3 text-xs sm:h-8 sm:px-2.5">
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Search and filters for the board and calendar views (the table has its own toolbar). */
export function TaskFilterBar({ filters, children }: { filters: FilterDef[]; children?: React.ReactNode }) {
  const url = useTableUrl();
  const [search, setSearch] = useState(url.get("q") ?? "");
  useEffect(() => {
    if ((url.get("q") ?? "") === search) return;
    const handle = window.setTimeout(() => url.set({ q: search || null }), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const active = useMemo(() => filters.some((f) => url.getList(f.key).length > 0) || Boolean(search), [filters, url, search]);

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2 max-sm:w-full">
          <InputGroup className="h-10 min-w-0 flex-1 sm:h-8 sm:w-64 sm:flex-none">
            <InputGroupAddon>
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" />
          </InputGroup>
          {/* Phones: the view switcher sits beside the search box to save a row. */}
          <div className="flex shrink-0 items-center sm:hidden">{children}</div>
        </div>
        {/* Phones: one scrolling row of chips instead of three wrapped rows. */}
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:p-0 [&::-webkit-scrollbar]:hidden">
          {filters.map((f) => (
            <FacetedFilter
              key={f.key}
              title={f.title}
              options={f.options}
              selected={url.getList(f.key)}
              onChange={(values) => url.set({ [f.key]: values.length ? values : null })}
            />
          ))}
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 px-2 sm:h-8"
              onClick={() => {
                setSearch("");
                url.set({ q: null, ...Object.fromEntries(filters.map((f) => [f.key, null])) });
              }}
            >
              Reset <X />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="hidden items-center gap-2 sm:flex">{children}</div>
    </div>
  );
}
