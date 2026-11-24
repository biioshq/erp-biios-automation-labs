import { Download, History } from "lucide-react";
import { Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { REPORT_FORMATS, labelOf } from "@/lib/constants";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { reportIcon } from "../meta";
import { DownloadAgainLink } from "./download-again";
import type { ReportHistoryRow } from "../types";

/** The latest exports, each with a link that rebuilds the report from today's data with the same filters. */
export function ExportHistory({ rows, ownOnly = false }: { rows: ReportHistoryRow[]; /** Members are listed only their own exports. */ ownOnly?: boolean }) {
  return (
    <Section
      title="Export history"
      description={`${ownOnly ? "Your last 20 downloads" : "The last 20 downloads"}. Download again to rebuild a report from current data.`}
      contentClassName="p-0"
    >
      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState compact icon={History} title="No exports yet" description="Pick a report above and download it as PDF, Excel or CSV. It will be listed here." />
        </div>
      ) : (
        <>
        <ul className="divide-y md:hidden">
          {rows.map((r) => (
            <li key={r.id} className="space-y-1 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 truncate font-medium">{r.title}</p>
                <StatusBadge tone="neutral" dot={false}>
                  {labelOf(REPORT_FORMATS, r.format)}
                </StatusBadge>
              </div>
              {r.filtersSummary ? <p className="line-clamp-2 text-xs text-muted-foreground">{r.filtersSummary}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  {formatNumber(r.rowCount)} rows · {r.by ?? "Unknown"} · {formatRelative(r.createdAt)}
                </p>
                <DownloadAgainLink variant="outline" className="shrink-0" href={r.href} label={`Download ${r.title} again as ${labelOf(REPORT_FORMATS, r.format)}`}>
                  <Download /> Again
                </DownloadAgainLink>
              </div>
            </li>
          ))}
        </ul>
        <div className="overflow-x-auto max-md:hidden">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Report</th>
                <th className="px-3 py-2.5 font-medium">Format</th>
                <th className="px-3 py-2.5 font-medium">Filters</th>
                <th className="px-3 py-2.5 text-right font-medium">Rows</th>
                <th className="px-3 py-2.5 font-medium">By</th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-5 py-2.5">
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // Scenario exports are not report cards, so the icon comes from the icon map, not the card list.
                const Icon = reportIcon(r.type);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {Icon ? (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-muted-foreground">
                            <Icon className="size-4" />
                          </span>
                        ) : null}
                        <span className="font-medium">{r.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge tone="neutral" dot={false}>
                        {labelOf(REPORT_FORMATS, r.format)}
                      </StatusBadge>
                    </td>
                    <td className="max-w-64 truncate px-3 py-3 text-muted-foreground" title={r.filtersSummary}>
                      {r.filtersSummary}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-muted-foreground">{formatNumber(r.rowCount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{r.by ?? "Unknown"}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground" title={formatDateTime(r.createdAt)}>
                      {formatRelative(r.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <DownloadAgainLink variant="ghost" href={r.href} label={`Download ${r.title} again as ${labelOf(REPORT_FORMATS, r.format)}`}>
                        <Download /> Download
                      </DownloadAgainLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Section>
  );
}
