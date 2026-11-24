"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpRight, Calculator, FolderTree, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { DataTable, DateRangeFilter, useTableUrl } from "@/components/data-table";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { LIABILITY_STATUSES } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import { DUE_BUCKETS } from "../schemas";
import type { LiabilitySide } from "../groups";
import type { GroupSection, LiabilityListRow } from "../types";
import { LiabilityStatusBadge } from "./liability-badges";
import { DueCell } from "./loans-view";
import { LiabilityPanels, useLiabilityPanel } from "./liability-panels";

/** Search, lender, status, due and date filters in the URL, applied to every section's records. */
function FilterBar({ lenders }: { lenders: string[] }) {
  const url = useTableUrl();
  const keys = ["q", "lender", "status", "due", "from", "to"];
  const filtered = keys.some((k) => url.get(k));
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <InputGroup className="h-10 w-full sm:h-8 sm:w-64">
        <InputGroupAddon>
          <Search className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          // Remounts when the URL changes (Reset), so the box shows the search in effect.
          key={url.get("q") ?? ""}
          defaultValue={url.get("q") ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") url.set({ q: (e.target as HTMLInputElement).value || null });
          }}
          onBlur={(e) => {
            if ((e.target.value || null) !== url.get("q")) url.set({ q: e.target.value || null });
          }}
          placeholder="Search name, code, lender…"
          aria-label="Search"
        />
      </InputGroup>
      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] max-sm:[&>*]:shrink-0 sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        <FacetedFilter title="Status" options={LIABILITY_STATUSES.map((o) => ({ ...o }))} selected={url.getList("status")} onChange={(v) => url.set({ status: v })} />
        <FacetedFilter title="Due" options={DUE_BUCKETS.map((o) => ({ ...o }))} selected={url.getList("due")} onChange={(v) => url.set({ due: v })} />
        <FacetedFilter title="Lender" options={lenders.map((l) => ({ value: l, label: l }))} selected={url.getList("lender")} onChange={(v) => url.set({ lender: v })} />
        <DateRangeFilter from={url.get("from")} to={url.get("to")} label="Date" onChange={(r) => url.set({ from: r.from, to: r.to })} />
        {filtered ? (
          <Button variant="ghost" size="sm" className="h-8 px-2 max-md:h-10" onClick={() => url.set(Object.fromEntries(keys.map((k) => [k, null])))}>
            Reset <X />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Rows open through the table's row click, so the cells hold no buttons of their own.
const COLUMNS: ColumnDef<LiabilityListRow>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Liability",
    cell: ({ row }) => (
      <div className="min-w-48">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          <span className="font-mono">{row.original.code}</span> · {row.original.lender}
        </p>
      </div>
    ),
  },
  { id: "group", header: "Group", cell: ({ row }) => <span className="whitespace-nowrap text-sm">{row.original.groupLabel}</span> },
  { id: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span> },
  { id: "due", header: "Due", cell: ({ row }) => <DueCell row={row.original} /> },
  {
    id: "rate",
    header: "Rate",
    meta: { align: "right" },
    cell: ({ row }) => (row.original.interestRate !== null ? <span className="tabular">{formatNumber(row.original.interestRate)}%</span> : <span className="text-xs text-muted-foreground">None</span>),
  },
  { id: "original", header: "Original", meta: { align: "right" }, cell: ({ row }) => <Money value={row.original.originalAmount} /> },
  { id: "paid", header: "Paid", meta: { align: "right" }, cell: ({ row }) => <Money value={row.original.principalPaid} className="text-muted-foreground" /> },
  { id: "outstanding", header: "Outstanding", meta: { align: "right" }, cell: ({ row }) => <Money value={row.original.outstanding} className="font-semibold" /> },
  { id: "status", header: "Status", cell: ({ row }) => <LiabilityStatusBadge status={row.original.status} /> },
];

function SectionCard({
  section,
  groups,
  columns,
  filtered,
  onAdd,
  onOpen,
}: {
  section: GroupSection;
  groups: GroupOption[];
  columns: ColumnDef<LiabilityListRow>[];
  filtered: boolean;
  /** Null when the person cannot add liabilities. */
  onAdd: ((group: string) => void) | null;
  onOpen: (id: string) => void;
}) {
  const parents = groups.filter((g) => section.groupKeys.includes(g.key));
  return (
    // The overview's breakdown links here by group key.
    <div id={section.key} className="scroll-mt-24">
      <Section
        title={
          <span className="flex flex-wrap items-center gap-2">
            {section.label}
            {section.computed ? (
              <StatusBadge tone="info" dot={false} icon={<Calculator className="size-3" aria-hidden />} className="h-5 px-2 text-[11px]">
                Computed
              </StatusBadge>
            ) : null}
            {!section.builtIn ? (
              <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                Subgroup
              </StatusBadge>
            ) : null}
          </span>
        }
        description={section.description ?? undefined}
        actions={
          <>
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground">On the balance sheet</p>
              <Money value={section.amount} className="text-base font-semibold" />
            </div>
            {section.entry ? (
              <>
                {parents.length ? <AddSubgroupButton parents={parents} defaultParent={section.key} variant="ghost" /> : null}
                {onAdd ? (
                  <Button size="sm" variant="outline" onClick={() => onAdd(section.groupKeys.includes(section.key) ? section.key : section.groupKeys[0])}>
                    <Plus /> Add
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
        contentClassName="space-y-4"
      >
        {section.computedLines.length ? (
          <ul className="divide-y rounded-xl border">
            {section.computedLines.map((line) => (
              <li key={line.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-medium">{line.label}</p>
                  {line.note ? <p className="text-xs text-muted-foreground">{line.note}</p> : null}
                  {line.href ? (
                    <Link href={line.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
                      From {line.sourceLabel} <ArrowUpRight className="size-3" />
                    </Link>
                  ) : null}
                </div>
                <Money value={line.amount} className="text-sm font-semibold" />
              </li>
            ))}
            <li className="px-4 py-2 text-xs text-muted-foreground">Worked out from those records, so it is not edited here.</li>
          </ul>
        ) : null}

        {section.subgroups.length ? (
          <div className="flex flex-wrap gap-2">
            {section.subgroups.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ marginLeft: s.depth > 1 ? (s.depth - 1) * 8 : 0 }}>
                <FolderTree className="size-3 text-muted-foreground" />
                {s.label}
                <span className="text-muted-foreground">
                  · {s.count} · <Money value={s.outstanding} />
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {section.entry ? (
          section.rows.length ? (
            <>
              <DataTable id={`liability-section-${section.key}`} columns={columns} data={section.rows} hideToolbar getRowId={(r) => r.id} pageSize={10} onRowClick={(r) => onOpen(r.id)}
                renderMobileRow={(r) => (
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate font-medium">{r.name}</p>
                      <Money value={r.outstanding} className="shrink-0 font-semibold" />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{r.code}</span> · {r.lender} · {r.groupLabel}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <LiabilityStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
                      {r.dueDate ? <span>Due {formatDate(r.dueDate)}</span> : <span>No due date</span>}
                    </div>
                  </div>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {filtered ? `${section.rows.length} of ${section.totalCount} records match the filters. ` : null}
                Outstanding on {section.totalCount === 1 ? "this record" : `these ${section.totalCount} records`}: <Money value={section.outstanding} className="font-medium text-foreground" />
              </p>
            </>
          ) : (
            <EmptyState
              compact
              icon={section.totalCount ? Search : FolderTree}
              title={section.totalCount ? "No records match the filters" : "Nothing recorded in this group"}
              description={section.totalCount ? undefined : "Add an amount owed here, such as TDS, salaries due or a loan, with who it is owed to and when it is due."}
              action={
                section.totalCount || !onAdd ? undefined : (
                  <Button size="sm" variant="outline" onClick={() => onAdd(section.groupKeys.includes(section.key) ? section.key : section.groupKeys[0])}>
                    <Plus /> Add
                  </Button>
                )
              }
            />
          )
        ) : null}
      </Section>
    </div>
  );
}

/** The Current or Non-current page: a section per group, with the shared drawers. */
export function GroupSectionsView({
  side,
  sections,
  groups,
  accounts,
  lenders,
  categories,
}: {
  side: LiabilitySide;
  sections: GroupSection[];
  groups: GroupOption[];
  accounts: BankAccountOption[];
  lenders: string[];
  categories?: { value: string; label: string }[];
}) {
  const { setPanel, canCreate } = useLiabilityPanel();
  const url = useTableUrl();
  const filtered = ["q", "lender", "status", "due", "from", "to"].some((k) => url.get(k));
  return (
    <>
      <FilterBar lenders={lenders} />
      {sections.map((s) => (
        <SectionCard key={s.key} section={s} groups={groups} columns={COLUMNS} filtered={filtered} onAdd={canCreate ? (group) => setPanel({ kind: "new", group }) : null} onOpen={(id) => setPanel({ kind: "view", id })} />
      ))}
      <LiabilityPanels groups={groups} accounts={accounts} lenders={lenders} defaultKind="other" side={side} categories={categories} />
    </>
  );
}
