import "server-only";

import type { ReportType } from "@/lib/constants";
import { buildCaReport } from "./builders/ca";
import { buildExpenseReport } from "./builders/expense";
import { buildFinanceReport } from "./builders/finance";
import { buildGstReport } from "./builders/gst";
import { buildIncomeReport } from "./builders/income";
import { buildInventoryReport } from "./builders/inventory";
import { buildProjectReport } from "./builders/project";
import type { ReportData, ReportFilters, ReportSection } from "../types";

export function buildReport(type: ReportType, filters: ReportFilters): Promise<ReportData> {
  switch (type) {
    case "expense":
      return buildExpenseReport(filters);
    case "income":
      return buildIncomeReport(filters);
    case "finance":
      return buildFinanceReport(filters);
    case "gst":
      return buildGstReport(filters);
    case "project":
      return buildProjectReport(filters);
    case "inventory":
      return buildInventoryReport(filters);
    case "ca":
      return buildCaReport(filters);
  }
}

/** Every table of a report in order (the primary table alone when there are no sections). */
export function sectionsOf(report: ReportData): ReportSection[] {
  return report.sections ?? [{ title: report.title, columns: report.columns, rows: report.rows, totals: report.totals }];
}

/** Data rows for the export log: the registers of the CA pack, otherwise the primary table. Subtotals do not count. */
export function rowCountOf(report: ReportData): number {
  const sections = sectionsOf(report);
  const tables = report.type === "ca" ? sections.slice(1, 4) : sections.slice(0, 1);
  return tables.reduce((s, sec) => s + sec.rows.filter((r) => r._kind !== "subtotal").length, 0);
}
