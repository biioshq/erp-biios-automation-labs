import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge, StatusBadge } from "@/components/shared/status-badge";
import { DEPARTMENTS, PAYMENT_STATUSES, labelOf, type Department, type PaymentStatus } from "@/lib/constants";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EDGE_CELLS } from "../../inventory/components/table-kit";
import type { EmployeeLoad, MaintenanceDue, ProjectHealth, PurchaseRequirement } from "../../dashboard/types";
import type { MaterialRow, PartyBalance, PriceChange, PriceComparison, VendorBill, VendorRow } from "../types";

/** Tables for the insights pages. Each scrolls sideways inside its own box on phones. */

const day = (d: string | null) => (d ? formatDate(fromDateInput(d)) : "Not set");
const qty = (n: number, unit: string) => `${formatNumber(n)} ${unit}`;

const PAY_TONE: Record<PaymentStatus, "success" | "warning" | "danger" | "neutral"> = { paid: "success", partial: "warning", unpaid: "neutral", overdue: "danger" };

/** Projects with money, tasks and delay flags. */
export function ProjectsTable({ rows }: { rows: ProjectHealth[] }) {
  return (
    <Table className={cn("min-w-[860px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Contract value</TableHead>
          <TableHead className="text-right">Budget</TableHead>
          <TableHead className="text-right">Spent</TableHead>
          <TableHead className="text-right">Budget used</TableHead>
          <TableHead className="text-right">Tasks done</TableHead>
          <TableHead>Schedule</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <Link href={`/finance/projects/${p.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                <span className="truncate font-medium">{p.name}</span>
              </Link>
              <p className="pl-[18px] text-xs text-muted-foreground">{p.code}</p>
            </TableCell>
            <TableCell>
              <ProjectStatusBadge status={p.status} />
            </TableCell>
            <TableCell className="text-right">{p.contractValue === null ? <span className="text-xs text-muted-foreground">Not recorded</span> : <Money value={p.contractValue} />}</TableCell>
            <TableCell className="text-right">
              <Money value={p.budget} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={p.spent} className="font-medium" />
            </TableCell>
            <TableCell className={cn("tabular text-right", p.usage !== null && p.usage > 1 && "font-medium text-danger")}>{p.usage === null ? "No budget" : formatPercent(p.usage)}</TableCell>
            <TableCell className="tabular text-right">{p.tasks.total ? `${formatNumber(p.tasks.done)} of ${formatNumber(p.tasks.total)}` : "No tasks"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                {p.pastEnd ? <StatusBadge tone="danger">Past end date</StatusBadge> : null}
                {p.tasks.overdue > 0 ? (
                  <Link href={`/tasks/status/overdue?project=${p.id}`} className="hover:underline">
                    <StatusBadge tone="warning">{formatNumber(p.tasks.overdue)} overdue</StatusBadge>
                  </Link>
                ) : null}
                {!p.pastEnd && !p.tasks.overdue ? <span className="text-xs whitespace-nowrap text-muted-foreground">Ends {day(p.endDate)}</span> : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const ALERT_LABEL = { out: "Out of stock", below_min: "Below minimum", runs_out: "Running out" } as const;

/** Items to buy, soonest order date first. */
export function RequirementsTable({ rows }: { rows: PurchaseRequirement[] }) {
  return (
    <Table className={cn("min-w-[720px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead className="text-right">Use per day</TableHead>
          <TableHead>Order by</TableHead>
          <TableHead className="text-right">Suggested qty</TableHead>
          <TableHead className="text-right">Estimated cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={`/inventory/items/${r.id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {r.sku}
                {r.alert ? `, ${ALERT_LABEL[r.alert].toLowerCase()}` : ""}
              </p>
            </TableCell>
            <TableCell className="tabular text-right">
              {qty(r.available, r.unit)}
              {r.minStock > 0 ? <p className="text-xs text-muted-foreground">min {formatNumber(r.minStock)}</p> : null}
            </TableCell>
            <TableCell className="tabular text-right">{r.perDay ? formatNumber(Math.round(r.perDay * 100) / 100) : <span className="text-xs text-muted-foreground">Too little history</span>}</TableCell>
            <TableCell>{r.orderNow ? <StatusBadge tone="danger">Now</StatusBadge> : <span className="whitespace-nowrap">{day(r.reorderDate)}</span>}</TableCell>
            <TableCell className="tabular text-right">
              {qty(r.qty, r.unit)}
              {r.basis === "minimum" ? <p className="text-xs text-muted-foreground">to the minimum</p> : null}
            </TableCell>
            <TableCell className="text-right">
              {r.estimatedCost === null ? <span className="text-xs text-muted-foreground">No price</span> : <Money value={r.estimatedCost} />}
              {r.priceBasis === "average" ? <p className="text-xs text-muted-foreground">at average cost</p> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Customers or suppliers with what is still open. */
export function PartyTable({ rows, label, countLabel }: { rows: PartyBalance[]; label: string; countLabel: string }) {
  return (
    <Table className={cn("min-w-[420px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          <TableHead className="text-right">{countLabel}</TableHead>
          <TableHead className="text-right">Outstanding</TableHead>
          <TableHead className="text-right">Overdue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell className="max-w-56 truncate font-medium">{r.name}</TableCell>
            <TableCell className="tabular text-right">{formatNumber(r.count)}</TableCell>
            <TableCell className="text-right">
              <Money value={r.outstanding} className="font-medium" />
            </TableCell>
            <TableCell className="text-right">{r.overdue > 0 ? <Money value={r.overdue} className="text-danger" /> : <span className="text-muted-foreground">None</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Vendors by what was bought from them. Names open the vendor's history. */
export function VendorTable({ rows, hrefOf, showOutstanding }: { rows: VendorRow[]; hrefOf: (key: string) => string; showOutstanding?: boolean }) {
  return (
    <Table className={cn("min-w-[680px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead className="text-right">Bills</TableHead>
          <TableHead className="text-right">Stock purchases</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead>First and last bill</TableHead>
          {showOutstanding ? <TableHead className="text-right">Outstanding today</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <TableRow key={v.key || "none"}>
            <TableCell className="max-w-64">
              <Link href={hrefOf(v.key)} className="block truncate font-medium hover:underline">
                {v.name}
              </Link>
            </TableCell>
            <TableCell className="tabular text-right">{formatNumber(v.bills)}</TableCell>
            <TableCell className="tabular text-right">{v.stock ? `${formatNumber(v.stock)} (${formatNumber(v.items)} ${v.items === 1 ? "item" : "items"})` : "None"}</TableCell>
            <TableCell className="text-right">
              <Money value={v.value} className="font-medium" />
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{v.first === v.last ? day(v.first) : `${day(v.first)} to ${day(v.last)}`}</TableCell>
            {showOutstanding ? <TableCell className="text-right">{v.outstanding > 0 ? <Money value={v.outstanding} /> : <span className="text-muted-foreground">None</span>}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Quantity, value and prices per item bought. */
export function MaterialTable({ rows }: { rows: MaterialRow[] }) {
  return (
    <Table className={cn("min-w-[760px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Purchases</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right">Average price</TableHead>
          <TableHead className="text-right">Lowest to highest</TableHead>
          <TableHead className="text-right">Latest price</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={`/inventory/items/${r.id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {r.sku}, {r.vendors === 1 ? "1 vendor" : `${formatNumber(r.vendors)} vendors`}
              </p>
            </TableCell>
            <TableCell className="tabular text-right">{formatNumber(r.purchases)}</TableCell>
            <TableCell className="tabular text-right">{qty(r.qty, r.unit)}</TableCell>
            <TableCell className="text-right">
              <Money value={r.value} className="font-medium" />
            </TableCell>
            <TableCell className="text-right">{r.avgPrice === null ? "None" : <Money value={r.avgPrice} />}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
              {r.minPrice === r.maxPrice ? (
                <Money value={r.minPrice} />
              ) : (
                <>
                  <Money value={r.minPrice} /> to <Money value={r.maxPrice} />
                </>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.lastPrice} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const changeTone = (c: number | null) => (c === null || Math.abs(c) < 0.0005 ? "text-muted-foreground" : c > 0 ? "text-danger" : "text-success");
const changeText = (c: number | null) => (c === null ? "Not known" : Math.abs(c) < 0.0005 ? "No change" : `${c > 0 ? "+" : ""}${formatPercent(c)}`);

/** First and latest price per item: rises in red, falls in green. */
export function PriceChangeTable({ rows, hrefOf }: { rows: PriceChange[]; hrefOf: (id: string) => string }) {
  return (
    <Table className={cn("min-w-[640px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Purchases</TableHead>
          <TableHead className="text-right">First price</TableHead>
          <TableHead className="text-right">Latest price</TableHead>
          <TableHead className="text-right">Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={hrefOf(r.id)} scroll={false} className="font-medium hover:underline">
                {r.name}
              </Link>
              <p className="text-xs text-muted-foreground">Latest from {r.lastVendor}</p>
            </TableCell>
            <TableCell className="tabular text-right">{formatNumber(r.purchases)}</TableCell>
            <TableCell className="text-right">
              <Money value={r.firstPrice} />
              <p className="text-xs text-muted-foreground">{day(r.firstDate)}</p>
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.lastPrice} />
              <p className="text-xs text-muted-foreground">{day(r.lastDate)}</p>
            </TableCell>
            <TableCell className={cn("tabular text-right font-medium", changeTone(r.change))}>{changeText(r.change)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The same item from different vendors: cheapest average first. */
export function ComparisonTable({ rows }: { rows: PriceComparison[] }) {
  return (
    <Table className={cn("min-w-[680px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Item and vendor</TableHead>
          <TableHead className="text-right">Purchases</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Average price</TableHead>
          <TableHead className="text-right">Latest price</TableHead>
        </TableRow>
      </TableHeader>
      {rows.map((r) => (
        <TableBody key={r.id} className="border-b last:border-b-0">
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={5}>
              <Link href={`/inventory/items/${r.id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <span className="ml-2 text-xs text-muted-foreground">
                {r.spread === null ? "" : r.spread > 0 ? `Highest average is ${formatPercent(r.spread)} above the lowest` : "Same average price"}
              </span>
            </TableCell>
          </TableRow>
          {r.vendors.map((v, i) => (
            <TableRow key={v.vendor}>
              <TableCell className="pl-6">
                <span className="truncate">{v.vendor}</span>
                {i === 0 && r.vendors.length > 1 && (r.spread ?? 0) > 0 ? (
                  <StatusBadge tone="success" dot={false} className="ml-2">
                    Lowest
                  </StatusBadge>
                ) : null}
              </TableCell>
              <TableCell className="tabular text-right">{formatNumber(v.purchases)}</TableCell>
              <TableCell className="tabular text-right">{qty(v.qty, r.unit)}</TableCell>
              <TableCell className="text-right">
                <Money value={v.avgPrice} className="font-medium" />
              </TableCell>
              <TableCell className="text-right">
                <Money value={v.lastPrice} />
                <p className="text-xs text-muted-foreground">{day(v.lastDate)}</p>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  );
}

/** One vendor's bills, newest first, each opening the expense. */
export function BillsTable({ rows }: { rows: VendorBill[] }) {
  return (
    <Table className={cn("min-w-[680px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Bill</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Payment</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="max-w-72">
              <Link href={`/finance/expenses?view=${b.id}`} className="font-medium hover:underline">
                {b.number}
              </Link>
              {b.description ? <p className="truncate text-xs text-muted-foreground">{b.description}</p> : null}
            </TableCell>
            <TableCell className="whitespace-nowrap">{day(b.date)}</TableCell>
            <TableCell className="text-muted-foreground">{b.category}</TableCell>
            <TableCell className="text-right">
              <Money value={b.amount} className="font-medium" />
            </TableCell>
            <TableCell>
              <StatusBadge tone={PAY_TONE[b.status]}>{labelOf(PAYMENT_STATUSES, b.status)}</StatusBadge>
              {b.outstanding > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <Money value={b.outstanding} /> to pay
                </p>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Stock received against stock used and wasted, per item. */
export function ItemUseTable({ rows }: { rows: { id: string; name: string; unit: string; received: number; consumed: number; wasted: number; available: number; ratio: number | null }[] }) {
  return (
    <Table className={cn("min-w-[640px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Used on projects</TableHead>
          <TableHead className="text-right">Wasted</TableHead>
          <TableHead className="text-right">Available now</TableHead>
          <TableHead className="text-right">Used ÷ received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={`/inventory/items/${r.id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
            </TableCell>
            <TableCell className="tabular text-right">{qty(r.received, r.unit)}</TableCell>
            <TableCell className="tabular text-right">{qty(r.consumed, r.unit)}</TableCell>
            <TableCell className={cn("tabular text-right", r.wasted > 0 && "text-danger")}>{qty(r.wasted, r.unit)}</TableCell>
            <TableCell className="tabular text-right">{qty(r.available, r.unit)}</TableCell>
            <TableCell className="tabular text-right">{r.ratio === null ? <span className="text-xs text-muted-foreground">Nothing received</span> : formatPercent(r.ratio)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** People and how much of their time open projects take. */
export function PeopleTable({ rows }: { rows: EmployeeLoad[] }) {
  return (
    <Table className={cn("sm:min-w-[480px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead className="text-right">Allocated</TableHead>
          <TableHead>Projects</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="max-sm:whitespace-normal">
              <Link href={`/finance/employees/${e.id}`} className="font-medium hover:underline">
                {e.name}
              </Link>
              <p className="text-xs text-muted-foreground">{e.department ? labelOf(DEPARTMENTS, e.department as Department) : ""}</p>
            </TableCell>
            <TableCell className={cn("tabular text-right font-medium", e.allocation > 100 && "text-danger", e.allocation === 0 && "text-muted-foreground")}>{formatNumber(e.allocation)}%</TableCell>
            <TableCell className="min-w-28 text-xs whitespace-normal text-muted-foreground sm:min-w-48">
              {e.projects.length ? e.projects.map((p) => `${p.name} (${formatNumber(p.allocation)}%)`).join(", ") : "On no current project"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Equipment and where it is today. */
export function EquipmentTable({ rows }: { rows: { id: string; code: string; name: string; project: { id: string; name: string } | null; until: string | null }[] }) {
  return (
    <Table className={cn("min-w-[480px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Equipment</TableHead>
          <TableHead>On project</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((a) => (
          <TableRow key={a.id}>
            <TableCell>
              <span className="font-medium">{a.name}</span>
              <p className="text-xs text-muted-foreground">{a.code}</p>
            </TableCell>
            <TableCell>
              {a.project ? (
                <>
                  <Link href={`/finance/projects/${a.project.id}`} className="hover:underline">
                    {a.project.name}
                  </Link>
                  {a.until ? <p className="text-xs text-muted-foreground">Until {day(a.until)}</p> : null}
                </>
              ) : (
                <span className="text-muted-foreground">Free</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Equipment with a service due soon or past due. */
export function MaintenanceTable({ rows }: { rows: MaintenanceDue[] }) {
  return (
    <Table className={cn("min-w-[520px]", EDGE_CELLS)}>
      <TableHeader>
        <TableRow>
          <TableHead>Equipment</TableHead>
          <TableHead>Last service</TableHead>
          <TableHead>Next due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.id}>
            <TableCell>
              <span className="font-medium">{m.name}</span>
              <p className="text-xs text-muted-foreground">{m.code}</p>
            </TableCell>
            <TableCell className="max-w-64">
              <span className="whitespace-nowrap">{day(m.lastDate)}</span>
              {m.lastDescription ? <p className="truncate text-xs text-muted-foreground">{m.lastDescription}</p> : null}
            </TableCell>
            <TableCell>
              {m.overdue ? <StatusBadge tone="danger">Past due {day(m.dueDate)}</StatusBadge> : <span className="whitespace-nowrap">{day(m.dueDate)}</span>}
              {m.basis === "interval" ? <p className="text-xs text-muted-foreground">From the usual gap between services</p> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
