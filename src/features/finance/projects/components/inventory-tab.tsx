import Link from "next/link";
import { ArrowDownToLine, Boxes, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { PROJECT_STAGES, labelOf } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { getProjectInventory } from "../queries";
import type { ProjectDetail } from "../types";

/** Stock the project holds, from inventory assignments. Nothing is entered here by hand. */
export async function InventoryTab({ project }: { project: ProjectDetail }) {
  const { rows, totals } = await getProjectInventory(project.id);
  const assign = (
    <Button asChild>
      <Link href={`/inventory/assign?project=${project.id}`}>
        <Plus /> Assign inventory
      </Link>
    </Button>
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No inventory used yet"
        description="Assign stock to this project and it shows up here with its cost, and as an expense in the right stage."
        action={assign}
      />
    );
  }

  return (
    <Section
      title="Inventory used"
      description="Cost is the quantity still held times the unit cost at assignment."
      actions={assign}
      contentClassName="p-0"
    >
      <ul className="divide-y md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1.5 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              {r.item ? (
                <Link href={`/inventory/items/${r.item.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.item.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.item.sku}</span>
                </Link>
              ) : (
                <span className="min-w-0 flex-1 text-muted-foreground">Item removed</span>
              )}
              <Money value={r.totalCost} className="shrink-0 font-semibold" />
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="tabular">{formatNumber(r.quantityHeld)}</span> {r.item?.unit} held
              {r.quantityReturned > 0 ? <> · <span className="tabular">{formatNumber(r.quantityReturned)}</span> returned</> : null} · {formatDate(r.assignedAt)}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                {labelOf(PROJECT_STAGES, r.stage)}
              </StatusBadge>
              {r.item && r.quantityHeld > 0 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/inventory/return?project=${project.id}&item=${r.item.id}`}>
                    <ArrowDownToLine /> Return
                  </Link>
                </Button>
              ) : r.quantityHeld === 0 ? (
                <span className="text-xs text-muted-foreground">All returned</span>
              ) : null}
            </div>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3 text-sm font-semibold">
          <span>Total</span>
          <Money value={totals.value} />
        </li>
      </ul>
      <div className="max-md:hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Item</TableHead>
            <TableHead className="text-right">Held</TableHead>
            <TableHead className="text-right">Returned</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead className="text-right">Total cost</TableHead>
            <TableHead>Assigned</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="pr-5 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="pl-5">
                {r.item ? (
                  <Link href={`/inventory/items/${r.item.id}`} className="block min-w-40">
                    <span className="block font-medium hover:underline">{r.item.name}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{r.item.sku}</span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Item removed</span>
                )}
              </TableCell>
              <TableCell className="tabular text-right font-medium">
                {formatNumber(r.quantityHeld)} <span className="text-xs font-normal text-muted-foreground">{r.item?.unit}</span>
              </TableCell>
              <TableCell className="tabular text-right text-muted-foreground">{formatNumber(r.quantityReturned)}</TableCell>
              <TableCell className="text-right">
                <Money value={r.unitCost} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.totalCost} className="font-medium" />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.assignedAt)}</TableCell>
              <TableCell>
                <StatusBadge tone="neutral" dot={false}>
                  {labelOf(PROJECT_STAGES, r.stage)}
                </StatusBadge>
              </TableCell>
              <TableCell className="pr-5 text-right">
                {r.item && r.quantityHeld > 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/inventory/return?project=${project.id}&item=${r.item.id}`}>
                      <ArrowDownToLine /> Return
                    </Link>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{r.quantityHeld === 0 ? "All returned" : ""}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="pl-5 font-semibold">Total</TableCell>
            <TableCell className="tabular text-right font-semibold">{formatNumber(totals.held)}</TableCell>
            <TableCell className="tabular text-right font-semibold">{formatNumber(totals.returned)}</TableCell>
            <TableCell />
            <TableCell className="text-right">
              <Money value={totals.value} className="font-semibold" />
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
        </TableFooter>
      </Table>
      </div>
    </Section>
  );
}
