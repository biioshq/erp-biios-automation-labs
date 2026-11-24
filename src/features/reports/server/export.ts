import "server-only";

import { financialYearIST, toDateInput } from "@/lib/dates";
import type { ReportFormat, ReportType } from "@/lib/constants";
import { isLegacyReport, reportInfo } from "../catalog";
import type { ReportData, ReportFilters } from "../types";
import { renderCsv } from "./render-csv";
import { renderPdf } from "./render-pdf";
import { renderXlsx } from "./render-xlsx";

export const CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

/** biios-expense-report-2026-04-01-to-2026-11-19.xlsx */
export function reportFileName(type: ReportType, format: ReportFormat, filters: Pick<ReportFilters, "from" | "to" | "movements">): string {
  const name = type === "inventory" && filters.movements ? "inventory-movements" : type.replace(/_/g, "-");
  const today = toDateInput(new Date());
  // The newer reports: biios-balance-sheet-as-of-2026-11-23.pdf, biios-payables-report-2026-11-23.pdf.
  const dates = reportInfo(type);
  if (dates && !isLegacyReport(type)) {
    if (dates.filters.includes("asOf")) return `biios-${name}-as-of-${filters.to && filters.to < today ? filters.to : today}.${format}`;
    if (!dates.filters.includes("date")) return `biios-${name}-report-${today}.${format}`;
    // A period report without a start covers the financial year to date, as the statements do.
    const to = filters.to && filters.to < today ? filters.to : today;
    return `biios-${name}-report-${filters.from ?? toDateInput(financialYearIST().start)}-to-${to}.${format}`;
  }
  // The project report (lifetime figures) and the stock valuation (as of now) do not use the dates.
  if (type === "project" || (type === "inventory" && !filters.movements)) return `biios-${name}-report-${today}.${format}`;
  const from = filters.from ?? "start";
  const to = filters.to ?? today;
  return `biios-${name}-report-${from}-to-${to}.${format}`;
}

export async function renderReport(report: ReportData, format: ReportFormat): Promise<Buffer> {
  if (format === "csv") return renderCsv(report);
  if (format === "xlsx") return renderXlsx(report);
  return renderPdf(report);
}
