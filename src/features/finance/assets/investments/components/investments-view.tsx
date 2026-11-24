"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { useOnLiveChange } from "@/components/live-updates";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import type { GroupOption } from "@/features/finance/groups/types";
import { AssetToolbar, type RegisterLayout } from "@/features/finance/assets/fixed/components/asset-toolbar";
import { INVESTMENT_TYPES, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import { cn } from "@/lib/utils";
import type { BankAccountOption } from "@/server/lookups";
import { deleteInvestment, fetchInvestment } from "../actions";
import { INVESTMENT_STATUSES } from "../schemas";
import type { InvestmentDetail, InvestmentGroupNode, InvestmentList, InvestmentRow } from "../types";
import { InvestmentDetailSkeleton, InvestmentDetailView } from "./investment-detail";
import { INVESTMENT_ROOT_KEY, InvestmentForm } from "./investment-form";

type Panel = { kind: "new"; group?: string } | { kind: "view"; id: string } | { kind: "edit"; id: string } | null;

function descendants(groups: GroupOption[], key: string): GroupOption[] {
  const keys = new Set([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.parent && keys.has(g.parent) && !keys.has(g.key)) {
        keys.add(g.key);
        grew = true;
      }
    }
  }
  return groups.filter((g) => keys.has(g.key));
}

function Name({ row }: { row: InvestmentRow }) {
  return (
    <div className="min-w-44">
      <p className={cn("truncate font-medium", !row.held && "text-muted-foreground line-through decoration-muted-foreground/40")}>{row.name}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        {labelOf(INVESTMENT_TYPES, row.type)}
        {row.institution ? ` · ${row.institution}` : ""}
      </p>
    </div>
  );
}

/** Current value, or the redemption, or a dash: never a made-up figure. */
function ValueCell({ row }: { row: InvestmentRow }) {
  if (!row.held && row.redemption) return <span className="text-xs whitespace-nowrap text-muted-foreground">Redeemed {formatDate(row.redemption.date)}</span>;
  if (row.currentValue === null) return <span className="text-xs text-muted-foreground">Not valued</span>;
  return (
    <span className="block">
      <Money value={row.currentValue} />
      <span className="block text-[11px] text-muted-foreground">on {formatDate(row.valuedOn!)}</span>
    </span>
  );
}

function GroupTable({ rows, onOpen }: { rows: InvestmentRow[]; onOpen: (id: string) => void }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead>Investment</TableHead>
            <TableHead>Purchased</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Current value</TableHead>
            <TableHead>Matures</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
              <TableCell>
                <Name row={r} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.purchaseDate)}</TableCell>
              <TableCell className="text-right font-medium">
                <Money value={r.amount} />
              </TableCell>
              <TableCell className="text-right">
                <ValueCell row={r} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{r.maturityDate ? formatDate(r.maturityDate) : "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TotalsLine({ node }: { node: InvestmentGroupNode }) {
  const t = node.totals;
  if (!t.count && !t.redeemedCount) return <>Nothing recorded yet</>;
  return (
    <span className="tabular">
      {t.count} held · cost <Money value={t.cost} className="font-medium text-foreground" />
      {t.redeemedCount ? ` · ${t.redeemedCount} redeemed` : ""}
    </span>
  );
}

function Subgroup({ node, groups, onOpen, onAdd }: { node: InvestmentGroupNode; groups: GroupOption[]; onOpen: (id: string) => void; onAdd: (group: string) => void }) {
  return (
    <div className="border-t" style={{ paddingLeft: `${Math.min(node.depth, 4) * 12}px` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{node.label}</p>
          <p className="text-xs text-muted-foreground">
            <TotalsLine node={node} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => onAdd(node.key)}>
            <Plus /> Investment
          </Button>
          <AddSubgroupButton parents={descendants(groups, node.key)} defaultParent={node.key} label="Subgroup" variant="ghost" />
        </div>
      </div>
      <GroupTable rows={node.rows} onOpen={onOpen} />
      {node.children.map((c) => (
        <Subgroup key={c.key} node={c} groups={groups} onOpen={onOpen} onAdd={onAdd} />
      ))}
    </div>
  );
}

/**
 * Long-term investments by subgroup or as one register, with the create, detail and edit drawers.
 * The drawers follow the URL (?new=1, ?view=<id>, ?edit=<id>) so the books can link to a record.
 */
export function InvestmentsView({
  list,
  groups,
  accounts,
  layout,
}: {
  list: InvestmentList;
  /** long_term_investments and its subgroups. */
  groups: GroupOption[];
  accounts: BankAccountOption[];
  layout: RegisterLayout;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<InvestmentDetail | null>(null);
  const [version, setVersion] = useState(0);
  const activeGroups = useMemo(() => groups.filter((g) => !g.archived), [groups]);

  const panel: Panel = useMemo(() => {
    if (searchParams.get("new") === "1") return { kind: "new", group: searchParams.get("group") ?? undefined };
    const edit = searchParams.get("edit");
    if (edit) return { kind: "edit", id: edit };
    const view = searchParams.get("view");
    if (view) return { kind: "view", id: view };
    return null;
  }, [searchParams]);

  const setPanel = (next: Panel) => {
    const params = new URLSearchParams(searchParams.toString());
    ["new", "view", "edit", "group"].forEach((k) => params.delete(k));
    if (next?.kind === "new") {
      params.set("new", "1");
      if (next.group) params.set("group", next.group);
    }
    if (next?.kind === "view") params.set("view", next.id);
    if (next?.kind === "edit") params.set("edit", next.id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const panelId = panel && panel.kind !== "new" ? panel.id : null;
  if (!panelId && detail) setDetail(null);
  useEffect(() => {
    if (!panelId) return;
    if (detail?.id === panelId) return;
    let cancelled = false;
    fetchInvestment(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That investment no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load it. Check the connection and try again.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, version]);

  const viewing = useRef<string | null>(null);
  useEffect(() => {
    viewing.current = panel?.kind === "view" ? panel.id : null;
  });
  const reload = () => {
    const id = viewing.current;
    if (!id) return;
    fetchInvestment(id)
      .then((d) => {
        if (viewing.current !== id) return;
        if (!d) {
          toast.error("That investment no longer exists.");
          setPanel(null);
          return;
        }
        setDetail(d);
      })
      .catch(() => {
        // Offline: keep what is shown; the next change tries again.
      });
  };
  useOnLiveChange(reload);

  async function remove(v: InvestmentDetail) {
    const result = await deleteInvestment({ id: v.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${v.name} deleted`);
    viewing.current = null;
    emitDataChanged();
    setPanel(null);
    return true;
  }

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "group", title: "Group", options: activeGroups.map((g) => ({ value: g.key, label: g.path.split(" › ").slice(-2).join(" › ") })) },
      { key: "type", title: "Type", options: INVESTMENT_TYPES.map((o) => ({ ...o })) },
      { key: "status", title: "Status", options: INVESTMENT_STATUSES.map((o) => ({ ...o })) },
    ],
    [activeGroups],
  );

  const columns = useMemo<ColumnDef<InvestmentRow>[]>(
    () => [
      { id: "name", accessorKey: "name", meta: { label: "Investment" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Investment" />, cell: ({ row }) => <Name row={row.original} />, enableHiding: false },
      { id: "group", accessorKey: "groupPath", meta: { label: "Group" }, header: "Group", enableSorting: false, cell: ({ row }) => <span className="block min-w-36 text-xs text-muted-foreground">{row.original.groupPath.split(" › ").slice(-2).join(" › ")}</span> },
      { id: "reference", accessorKey: "reference", meta: { label: "Reference" }, header: "Reference", enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.reference ?? "-"}</span> },
      { id: "purchaseDate", accessorKey: "purchaseDate", meta: { label: "Purchased" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Purchased" />, cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.purchaseDate)}</span> },
      { id: "account", meta: { label: "Paid from" }, header: "Paid from", enableSorting: false, cell: ({ row }) => <span className="block min-w-28 text-xs text-muted-foreground">{row.original.account?.name ?? "Before the books"}</span> },
      { id: "amount", accessorKey: "amount", meta: { label: "Cost", align: "right" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Cost" align="right" />, cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
      { id: "currentValue", accessorKey: "currentValue", meta: { label: "Current value", align: "right" }, header: "Current value", enableSorting: false, cell: ({ row }) => <ValueCell row={row.original} /> },
      { id: "interestRate", accessorKey: "interestRate", meta: { label: "Rate", align: "right" }, header: "Rate", enableSorting: false, cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.interestRate !== null ? `${row.original.interestRate}%` : "-"}</span> },
      { id: "maturityDate", accessorKey: "maturityDate", meta: { label: "Matures" }, header: "Matures", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.maturityDate ? formatDate(row.original.maturityDate) : "-"}</span> },
      { id: "status", meta: { label: "Status" }, header: "Status", enableSorting: false, cell: ({ row }) => (row.original.held ? <StatusBadge tone="success">Held</StatusBadge> : <StatusBadge tone="neutral">Redeemed</StatusBadge>) },
    ],
    [],
  );

  const openNew = (group?: string) => setPanel({ kind: "new", group });
  const open = (id: string) => setPanel({ kind: "view", id });
  const nothing = !list.rows.length && !list.filtered;

  return (
    <>
      <AssetToolbar
        filters={filters}
        layout={layout}
        searchPlaceholder="Search name, institution, reference…"
        actions={<AddSubgroupButton parents={activeGroups} defaultParent={INVESTMENT_ROOT_KEY} label="Add subgroup" />}
      />

      {nothing && (layout === "register" || !list.tree.length) ? (
        <EmptyState
          icon={Landmark}
          title="No investments recorded yet"
          description="Add fixed deposits, mutual funds, shares or bonds the company holds for more than a year. The balance sheet carries them at cost."
          action={
            <Button onClick={() => openNew()}>
              <Plus /> Add investment
            </Button>
          }
        />
      ) : layout === "register" ? (
        <DataTable
          id="investments"
          columns={columns}
          data={list.rows}
          pageSize={50}
          hideToolbar
          getRowId={(r) => r.id}
          onRowClick={(r) => open(r.id)}
          initialHidden={["reference", "interestRate"]}
          rowClassName={(r) => (r.held ? undefined : "opacity-70")}
          renderMobileRow={(r) => (
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 truncate font-medium">{r.name}</p>
                <Money value={r.amount} className="shrink-0 font-semibold" />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {labelOf(INVESTMENT_TYPES, r.type)} · {r.groupLabel} · {formatDate(r.purchaseDate)}
              </p>
              <div className="text-xs text-muted-foreground">
                <ValueCell row={r} />
              </div>
            </div>
          )}
        />
      ) : (
        <div className="space-y-4">
          {list.filtered && !list.rows.length ? <EmptyState icon={Landmark} title="No investments match" description="Try another search or clear the filters." compact /> : null}
          {list.tree.map((node) => (
            <Section
              key={node.key}
              title={node.label}
              description={<TotalsLine node={node} />}
              contentClassName="p-0"
              actions={
                node.key === "_unknown" || node.key === INVESTMENT_ROOT_KEY ? null : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openNew(node.key)}>
                      <Plus /> Investment
                    </Button>
                    <AddSubgroupButton parents={descendants(activeGroups, node.key)} defaultParent={node.key} />
                  </>
                )
              }
            >
              {node.rows.length || node.children.length ? (
                <>
                  <GroupTable rows={node.rows} onOpen={open} />
                  {node.children.map((c) => (
                    <Subgroup key={c.key} node={c} groups={activeGroups} onOpen={open} onAdd={openNew} />
                  ))}
                </>
              ) : (
                <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Nothing recorded in this subgroup yet.</p>
              )}
            </Section>
          ))}
        </div>
      )}

      <FormSheet
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        size="lg"
        title={panel?.kind === "new" ? "Add investment" : panel?.kind === "edit" ? `Edit ${detail?.name ?? "investment"}` : (detail?.name ?? "Investment")}
        description={panel?.kind === "new" ? "One record per investment. Record the money coming back as a redemption." : detail ? `${labelOf(INVESTMENT_TYPES, detail.type)} · ${detail.groupLabel}` : undefined}
      >
        {panel?.kind === "new" ? (
          <InvestmentForm groups={activeGroups} accounts={accounts} defaultGroup={panel.group} onDone={(id) => setPanel({ kind: "view", id })} onCancel={() => setPanel(null)} />
        ) : panel && detail?.id !== panel.id ? (
          <InvestmentDetailSkeleton />
        ) : panel?.kind === "edit" && detail ? (
          <InvestmentForm
            key={detail.id}
            investment={detail}
            groups={activeGroups}
            accounts={accounts}
            onDone={(id) => {
              setDetail(null);
              setVersion((v) => v + 1);
              setPanel({ kind: "view", id });
            }}
            onCancel={() => setPanel({ kind: "view", id: detail.id })}
          />
        ) : panel?.kind === "view" && detail ? (
          <InvestmentDetailView
            investment={detail}
            accounts={accounts}
            onEdit={() => setPanel({ kind: "edit", id: detail.id })}
            onChanged={reload}
            onDelete={() => remove(detail)}
          />
        ) : null}
      </FormSheet>
    </>
  );
}
