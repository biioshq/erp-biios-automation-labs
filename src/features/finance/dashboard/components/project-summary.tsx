import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import type { ProjectSummaryRow } from "../types";

const usageClass = (u: number | null) => (u === null ? "text-muted-foreground" : u > 1 ? "text-danger" : u >= 0.8 ? "text-warning" : "text-muted-foreground");

/** Open projects with the most spend: revenue, money received and still due, spend and estimated profit. */
export function ProjectSummaryTable({ rows }: { rows: ProjectSummaryRow[] }) {
  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon={FolderKanban}
        title="No open projects"
        description="Projects that are planning, active or on hold show here with their revenue, spend and profit."
        action={
          <Link href="/finance/projects?new=1" className="text-sm font-medium text-brand-ink hover:underline">
            New project
          </Link>
        }
      />
    );
  }
  return (
    <>
      <ul className="divide-y md:hidden">
        {rows.map((p) => (
          <li key={p.id}>
            <Link href={`/finance/projects/${p.id}`} className="block space-y-1.5 px-4 py-3 transition-colors hover:bg-muted/60">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                  <span className="truncate">{p.name}</span>
                </span>
                <ProjectStatusBadge status={p.status} />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Revenue</dt>
                  <dd>
                    <Money value={p.revenue} compact />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Spent</dt>
                  <dd>
                    <Money value={p.spent} compact />
                    {p.utilisation !== null ? <span className={cn("ml-1", usageClass(p.utilisation))}>{formatPercent(p.utilisation)}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Est. profit</dt>
                  <dd>
                    <Money value={p.estimatedProfit} compact tone="auto" />
                  </dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
      <div className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Project</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="text-right">Budget used</TableHead>
              <TableHead className="pr-5 text-right">Est. profit or loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-5">
                  <Link href={`/finance/projects/${p.id}`} className="flex min-w-40 items-center gap-2.5 hover:underline">
                    <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Money value={p.revenue} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={p.received} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={p.outstanding} className={p.outstanding > 0 ? undefined : "text-muted-foreground"} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={p.spent} className="font-medium" />
                </TableCell>
                <TableCell className={cn("tabular text-right text-sm", usageClass(p.utilisation))}>{p.utilisation === null ? "No budget" : formatPercent(p.utilisation)}</TableCell>
                <TableCell className="pr-5 text-right">
                  <Money value={p.estimatedProfit} tone="auto" className="font-medium" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
