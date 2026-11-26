import "server-only";

import type { ReportType } from "@/lib/constants";
import { buildCaReport } from "./builders/ca";
import { buildDailyReport } from "./builders/daily";
import { buildExpenseReport } from "./builders/expense";
import { buildFinanceReport } from "./builders/finance";
import { buildGstReport } from "./builders/gst";
import { buildIncomeReport } from "./builders/income";
import { buildInventoryReport } from "./builders/inventory";
import { buildProjectReport } from "./builders/project";
import { buildDepreciationReport, buildFixedAssetReport } from "./builders/assets";
import { buildCashBudgetReport, buildProjectFinancialsReport } from "./builders/planning";
import { buildEquityReport, buildLiabilitiesReport, buildPayablesReport, buildReceivablesReport } from "./builders/position";
import { buildBalanceSheetReport, buildCashFlowReport, buildProfitLossReport, buildTrialBalanceReport } from "./builders/statements";
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
    case "balance_sheet":
      return buildBalanceSheetReport(filters);
    case "profit_loss":
      return buildProfitLossReport(filters);
    case "cash_flow":
      return buildCashFlowReport(filters);
    case "trial_balance":
      return buildTrialBalanceReport(filters);
    case "fixed_assets":
      return buildFixedAssetReport(filters);
    case "depreciation":
      return buildDepreciationReport(filters);
    case "receivables":
      return buildReceivablesReport(filters);
    case "payables":
      return buildPayablesReport(filters);
    case "liabilities":
      return buildLiabilitiesReport(filters);
    case "equity":
      return buildEquityReport(filters);
    case "project_financials":
      return buildProjectFinancialsReport(filters);
    case "cash_budget":
      return buildCashBudgetReport(filters);
    case "daily":
      return buildDailyReport(filters);
    case "scenario":
      // What-if scenarios are exported from their own page (src/features/analytics/scenarios/server/export.ts).
      // parseReportRequest refuses the type, so this is reached only by a caller that skipped it.
      throw new Error("What-if scenarios are not built here. Export them from the scenario page.");
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
