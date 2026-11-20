import "server-only";

import { toDateInput } from "@/lib/dates";
import type { ReportFormat, ReportType } from "@/lib/constants";
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
  const name = type === "inventory" && filters.movements ? "inventory-movements" : type;
  const today = toDateInput(new Date());
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
