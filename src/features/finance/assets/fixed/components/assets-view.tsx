"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Armchair, KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { Section } from "@/components/shared/page";
import { useCan } from "@/components/current-user";
import { useOnLiveChange } from "@/components/live-updates";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import type { GroupOption } from "@/features/finance/groups/types";
import { ASSET_CONDITIONS, DEPARTMENTS, labelOf } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import { cn } from "@/lib/utils";
import { deleteFixedAsset, fetchFixedAsset } from "../actions";
import { labelsFor, type AssetKind } from "../labels";
import { ASSET_STATUSES } from "../schemas";
import type { AssetDetail, AssetGroupNode, AssetRegister, AssetRow } from "../types";
import { ConditionBadge, methodText } from "./asset-badges";
import { AssetDetailSkeleton, AssetDetailView } from "./asset-detail";
import { AssetForm, type AssetFormOptions } from "./asset-form";
import { AssetToolbar, type RegisterLayout } from "./asset-toolbar";

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

function AssetName({ row }: { row: AssetRow }) {
  return (
    <div className="min-w-44">
      <p className={cn("truncate font-medium", !row.inBooks && "text-muted-foreground line-through decoration-muted-foreground/40")}>{row.name}</p>
      <p className="truncate font-mono text-[11px] text-muted-foreground">
        {row.code}
        {row.quantity !== 1 ? <span> · {formatNumber(row.quantity)} units</span> : null}
        {row.location ? <span className="font-sans"> · {row.location}</span> : null}
      </p>
    </div>
  );
}

/** One group's assets as a small table that scrolls sideways on phones. */
function GroupTable({ rows, kind, onOpen }: { rows: AssetRow[]; kind: AssetKind; onOpen: (id: string) => void }) {
  const labels = labelsFor(kind);
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Purchased</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">{labels.accumulated}</TableHead>
            <TableHead className="text-right">{labels.value}</TableHead>
            <TableHead>Condition</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
              <TableCell>
                <AssetName row={r} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.purchaseDate)}</TableCell>
              <TableCell className="text-right">
                <Money value={r.purchaseCost} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                <Money value={r.accumulated} />
              </TableCell>
              <TableCell className="text-right font-medium">
                {r.inBooks ? <Money value={r.bookValue} /> : <span className="text-xs font-normal text-muted-foreground">Disposed {formatDate(r.disposal!.date)}</span>}
              </TableCell>
              <TableCell>
                <ConditionBadge condition={r.condition} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TotalsLine({ node, kind }: { node: AssetGroupNode; kind: AssetKind }) {
  const labels = labelsFor(kind);
  const t = node.totals;
  if (!t.count && !t.disposedCount) return <>No assets yet</>;
  return (
    <span className="tabular">
      {t.count} in the books · cost <Money value={t.cost} /> · {labels.accumulated.toLowerCase()} <Money value={t.accumulated} /> · {labels.value.toLowerCase()}{" "}
      <Money value={t.bookValue} className="font-medium text-foreground" />
      {t.disposedCount ? ` · ${t.disposedCount} disposed` : ""}
    </span>
  );
}

function Subgroup({
  node,
  kind,
  groups,
  onOpen,
  onAdd,
}: {
  node: AssetGroupNode;
  kind: AssetKind;
  groups: GroupOption[];
  onOpen: (id: string) => void;
  /** Null when the person cannot add assets. */
  onAdd: ((group: string) => void) | null;
}) {
  return (
    <div className="border-t" style={{ paddingLeft: `${Math.min(node.depth, 4) * 12}px` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{node.label}</p>
          <p className="text-xs text-muted-foreground">
            <TotalsLine node={node} kind={kind} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {onAdd ? (
            <Button size="sm" variant="ghost" onClick={() => onAdd(node.key)}>
              <Plus /> Asset
            </Button>
          ) : null}
          <AddSubgroupButton parents={descendants(groups, node.key)} defaultParent={node.key} label="Subgroup" variant="ghost" />
        </div>
      </div>
      <GroupTable rows={node.assets} kind={kind} onOpen={onOpen} />
      {node.children.map((c) => (
        <Subgroup key={c.key} node={c} kind={kind} groups={groups} onOpen={onOpen} onAdd={onAdd} />
      ))}
    </div>
  );
}

/**
 * The fixed or intangible asset register, by group (with subtotals and "+ Add subgroup" under every
 * category) or as one flat register, with the create, detail and edit drawers. The drawers follow
 * the URL (?new=1, ?view=<id>, ?edit=<id>) so the books and the command palette can link to them.
 */
export function AssetsView({
  kind,
  register,
  groups,
  options,
  layout,
}: {
  kind: AssetKind;
  register: AssetRegister;
  /** Groups assets of this kind can be filed under. */
  groups: GroupOption[];
  options: AssetFormOptions;
  layout: RegisterLayout;
}) {
  const labels = labelsFor(kind);
  // These only hide controls; every action checks the same permission on the server.
  const canCreate = useCan("finance.fixed_assets:create");
  const canEdit = useCan("finance.fixed_assets:edit");
  const canDelete = useCan("finance.fixed_assets:delete");
  const canDeleteExpenses = useCan("finance.expenses:delete");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [version, setVersion] = useState(0);

  const panel: Panel = useMemo(() => {
    if (searchParams.get("new") === "1") return canCreate ? { kind: "new", group: searchParams.get("group") ?? undefined } : null;
    const edit = searchParams.get("edit");
    if (edit) return canEdit ? { kind: "edit", id: edit } : { kind: "view", id: edit };
    const view = searchParams.get("view");
    if (view) return { kind: "view", id: view };
    return null;
  }, [searchParams, canCreate, canEdit]);

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
    fetchFixedAsset(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That asset no longer exists.");
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
    fetchFixedAsset(id)
      .then((d) => {
        if (viewing.current !== id) return;
        if (!d) {
          toast.error("That asset no longer exists.");
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

  async function remove(asset: AssetDetail, deleteBill: boolean) {
    const result = await deleteFixedAsset({ id: asset.id, deleteBill });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${asset.code} deleted`);
    viewing.current = null;
    emitDataChanged();
    setPanel(null);
    return true;
  }

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "group", title: "Group", options: groups.filter((g) => !g.archived).map((g) => ({ value: g.key, label: g.path.split(" › ").slice(-2).join(" › ") })) },
      { key: "condition", title: "Condition", options: ASSET_CONDITIONS.map((o) => ({ ...o })) },
      { key: "location", title: labels.locationLabel, options: options.locations.map((l) => ({ value: l, label: l })) },
      { key: "department", title: "Department", options: DEPARTMENTS.map((o) => ({ ...o })) },
      { key: "project", title: "Project", options: [{ value: "none", label: "No project" }, ...options.projects.map((p) => ({ value: p.value, label: p.label }))] },
      { key: "status", title: "Status", options: ASSET_STATUSES.map((o) => ({ ...o })) },
    ],
    [groups, options.locations, options.projects, labels.locationLabel],
  );

  const columns = useMemo<ColumnDef<AssetRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Asset" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Asset" />,
        cell: ({ row }) => <AssetName row={row.original} />,
        enableHiding: false,
      },
      { id: "group", accessorKey: "groupPath", meta: { label: "Group" }, header: "Group", enableSorting: false, cell: ({ row }) => <span className="block min-w-40 text-xs text-muted-foreground">{row.original.groupPath.split(" › ").slice(-2).join(" › ")}</span> },
      { id: "purchaseDate", accessorKey: "purchaseDate", meta: { label: "Purchased" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Purchased" />, cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.purchaseDate)}</span> },
      { id: "vendor", accessorKey: "vendor", meta: { label: "Vendor" }, header: "Vendor", enableSorting: false, cell: ({ row }) => <span className="block min-w-32 text-xs">{row.original.vendor ?? "-"}{row.original.invoiceNumber ? <span className="block font-mono text-muted-foreground">{row.original.invoiceNumber}</span> : null}</span> },
      { id: "allocation", meta: { label: "Allocation" }, header: "With", enableSorting: false, cell: ({ row }) => <span className="block min-w-32 text-xs text-muted-foreground">{[row.original.department ? labelOf(DEPARTMENTS, row.original.department) : null, row.original.assignedTo?.name, row.original.project?.name].filter(Boolean).join(" · ") || "-"}</span> },
      { id: "method", meta: { label: labels.charge }, header: labels.charge, enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{methodText(row.original.depreciationMethod, row.original.usefulLifeYears, row.original.wdvRate)}</span> },
      { id: "purchaseCost", accessorKey: "purchaseCost", meta: { label: "Cost", align: "right" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Cost" align="right" />, cell: ({ row }) => <Money value={row.original.purchaseCost} /> },
      { id: "accumulated", accessorKey: "accumulated", meta: { label: labels.accumulated, align: "right" }, header: ({ column }) => <DataTableColumnHeader column={column} title={labels.accumulated} align="right" />, cell: ({ row }) => <Money value={row.original.accumulated} className="text-muted-foreground" /> },
      { id: "bookValue", accessorKey: "bookValue", meta: { label: labels.value, align: "right" }, header: ({ column }) => <DataTableColumnHeader column={column} title={labels.value} align="right" />, cell: ({ row }) => (row.original.inBooks ? <Money value={row.original.bookValue} className="font-medium" /> : <span className="text-xs text-muted-foreground">Disposed</span>) },
      { id: "condition", accessorKey: "condition", meta: { label: "Condition" }, header: "Condition", enableSorting: false, cell: ({ row }) => <ConditionBadge condition={row.original.condition} /> },
      { id: "warrantyUntil", accessorKey: "warrantyUntil", meta: { label: "Warranty" }, header: "Warranty", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.warrantyUntil ? formatDate(row.original.warrantyUntil) : "-"}</span> },
    ],
    [labels],
  );

  const openNew = (group?: string) => setPanel({ kind: "new", group });
  const open = (id: string) => setPanel({ kind: "view", id });
  const editing = panel?.kind === "edit";
  const rootGroups = groups.filter((g) => !g.archived);
  const Icon = kind === "intangible" ? KeyRound : Armchair;
  const nothing = !register.rows.length && !register.filtered;

  return (
    <>
      <AssetToolbar
        filters={filters}
        layout={layout}
        searchPlaceholder="Search name, code, vendor…"
        actions={<AddSubgroupButton parents={rootGroups} defaultParent={labels.root} label={`Add subgroup under ${labels.page}`} />}
      />

      {nothing && layout === "register" ? (
        <EmptyState
          icon={Icon}
          title={`No ${labels.singular}s recorded yet`}
          description={kind === "intangible" ? "Add software and licences the company owns, with their useful life, to see their amortisation and carrying value." : "Add furniture, machines, vehicles and computers the company owns, with their useful life, to see depreciation and book value."}
          action={
            canCreate ? (
              <Button onClick={() => openNew()}>
                <Plus /> Add {labels.singular}
              </Button>
            ) : undefined
          }
        />
      ) : layout === "register" ? (
        <DataTable
          id={`assets-${kind}`}
          columns={columns}
          data={register.rows}
          pageSize={50}
          hideToolbar
          getRowId={(r) => r.id}
          onRowClick={(r) => open(r.id)}
          initialHidden={["vendor", "warrantyUntil"]}
          rowClassName={(r) => (r.inBooks ? undefined : "opacity-70")}
          renderMobileRow={(r) => (
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 truncate font-medium">{r.name}</p>
                {r.inBooks ? <Money value={r.bookValue} className="shrink-0 font-semibold" /> : <span className="text-xs text-muted-foreground">Disposed</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{r.code}</span> · {r.groupLabel} · {formatDate(r.purchaseDate)}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ConditionBadge condition={r.condition} className="h-5 px-2 text-[11px]" />
                <span>
                  Cost <Money value={r.purchaseCost} />
                </span>
              </div>
            </div>
          )}
        />
      ) : (
        <div className="space-y-4">
          {register.filtered && !register.rows.length ? (
            <EmptyState icon={Icon} title="No assets match" description="Try another search or clear the filters." compact />
          ) : null}
          {register.tree.map((node) => (
            <Section
              key={node.key}
              title={node.label}
              description={<TotalsLine node={node} kind={kind} />}
              contentClassName="p-0"
              actions={
                node.key === "_unknown" || node.key === labels.root ? null : (
                  <>
                    {canCreate ? (
                      <Button size="sm" variant="outline" onClick={() => openNew(node.key)}>
                        <Plus /> Asset
                      </Button>
                    ) : null}
                    <AddSubgroupButton parents={descendants(groups.filter((g) => !g.archived), node.key)} defaultParent={node.key} />
                  </>
                )
              }
            >
              {node.assets.length || node.children.length ? (
                <>
                  <GroupTable rows={node.assets} kind={kind} onOpen={open} />
                  {node.children.map((c) => (
                    <Subgroup key={c.key} node={c} kind={kind} groups={groups.filter((g) => !g.archived)} onOpen={open} onAdd={canCreate ? openNew : null} />
                  ))}
                </>
              ) : (
                <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">{node.description ?? "Nothing recorded in this group yet."}</p>
              )}
            </Section>
          ))}
        </div>
      )}

      <FormSheet
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        size="lg"
        title={panel?.kind === "new" ? `Add ${labels.singular}` : editing ? `Edit ${detail?.code ?? "asset"}` : (detail?.name ?? labels.page)}
        description={panel?.kind === "new" ? "One record per purchase. Quantity covers several identical units." : detail ? `${detail.code} · ${detail.groupLabel}` : undefined}
      >
        {panel?.kind === "new" ? (
          <AssetForm kind={kind} options={{ ...options, groups: rootGroups }} defaultGroup={panel.group} onDone={(id) => setPanel({ kind: "view", id })} onCancel={() => setPanel(null)} />
        ) : panel && detail?.id !== panel.id ? (
          <AssetDetailSkeleton />
        ) : panel?.kind === "edit" && detail ? (
          <AssetForm
            key={detail.id}
            kind={detail.kind}
            asset={detail}
            canDeleteBills={canDelete && canDeleteExpenses}
            options={{ ...options, groups: rootGroups }}
            onDone={(id) => {
              setDetail(null);
              setVersion((v) => v + 1);
              setPanel({ kind: "view", id });
            }}
            onCancel={() => setPanel({ kind: "view", id: detail.id })}
          />
        ) : panel?.kind === "view" && detail ? (
          <AssetDetailView
            asset={detail}
            accounts={options.accounts}
            canEdit={canEdit}
            canDelete={canDelete}
            canDeleteBills={canDelete && canDeleteExpenses}
            onEdit={() => setPanel({ kind: "edit", id: detail.id })}
            onChanged={reload}
            onDelete={(deleteBill) => remove(detail, deleteBill)}
          />
        ) : null}
      </FormSheet>
    </>
  );
}
