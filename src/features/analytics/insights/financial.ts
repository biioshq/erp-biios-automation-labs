import "server-only";

import { budgetUsage, financeTotals, monthlyIncomeExpense } from "@/server/services/metrics";
import { cashBalances, cashFlow, profitAndLoss } from "@/server/accounting/statements";
import { endOfDayIST, financialYearIST, startOfMonthIST } from "@/lib/dates";
import { OPEN_PROJECT_STATUSES, monthKeys } from "../dashboard/measures";
import { TREND_MONTHS } from "../dashboard/rules";
import { budgetUse } from "../projects/model";
import { receivables, viewerPayables } from "./shared";
import type { FinancialInsights } from "./types";

const TOP = 6;

/**
 * Profit and loss for each of the last 12 months, from the accounting engine. The current month
 * ends at `asOf`, the same instant the year's P&L and cash flow use, so those share one ledger build.
 */
async function monthlyPl(asOf: Date, now: Date) {
  const keys = monthKeys(TREND_MONTHS, now);
  const months = await Promise.all(
    keys.map(async (month, i) => {
      const from = startOfMonthIST(now, -(TREND_MONTHS - 1) + i);
      const last = i === keys.length - 1;
      const to = last ? asOf : new Date(startOfMonthIST(now, -(TREND_MONTHS - 1) + i + 1).getTime() - 1);
      const pl = await profitAndLoss(from, to);
      return { month, income: pl.totalIncome, expenses: pl.totalExpenses, profit: pl.profit, grossProfit: pl.grossProfit };
    }),
  );
  return months;
}

/** 6.2 Financial performance. P&L and cash figures are computed only for viewers who see the financial position. */
export async function getFinancialInsights(viewer: { salaries: boolean; cash: boolean }, now: Date = new Date()): Promise<FinancialInsights> {
  const fy = financialYearIST(now);
  const asOf = endOfDayIST(now);
  const [monthly, totals, budgets, rec, pay, admin] = await Promise.all([
    monthlyIncomeExpense(TREND_MONTHS),
    financeTotals({ from: fy.start, to: asOf }),
    budgetUsage({ status: OPEN_PROJECT_STATUSES }, { includeSalaries: viewer.salaries }),
    receivables(now),
    viewerPayables(viewer.salaries, now),
    viewer.cash
      ? Promise.all([monthlyPl(asOf, now), profitAndLoss(fy.start, asOf), cashFlow(fy.start, asOf), cashBalances(asOf)])
      : Promise.resolve(null),
  ]);

  const withBudget = budgets.filter((b) => b.budget > 0 || b.spent > 0);
  // Budget used: the shared measure (active projects with a budget), as on the dashboard and Budget vs actual.
  const use = budgetUse(budgets.filter((b) => b.status === "active"));

  let pl: FinancialInsights["pl"] = null;
  let cash: FinancialInsights["cash"] = null;
  if (admin) {
    const [months, year, flow, balances] = admin;
    pl = { months, fy: { income: year.totalIncome, expenses: year.totalExpenses, profit: year.profit, grossProfit: year.grossProfit, from: year.from, to: year.to } };
    cash = {
      from: flow.from,
      to: flow.to,
      opening: flow.opening,
      closing: flow.closing,
      netChange: flow.netChange,
      activities: flow.activities.map((a) => ({ key: a.key, label: a.label, net: a.net })),
      accounts: balances.filter((b) => !b.archived || Math.abs(b.balance) >= 0.005).map((b) => ({ code: b.code, name: b.name, balance: b.balance })),
    };
  }

  return {
    fyLabel: fy.label,
    fy: { income: totals.income, expenses: totals.expenses },
    monthly,
    pl,
    cash,
    budget: {
      rows: withBudget.map((b) => ({ id: b.id, label: b.name, budget: b.budget, spent: b.spent, usage: b.budget > 0 ? b.spent / b.budget : null })),
      total: { budget: use.budget, spent: use.spent, usage: use.usage, projects: use.projects },
    },
    receivables: rec.totals,
    topClients: rec.byClient.slice(0, TOP),
    payables: pay.totals,
    topVendors: pay.byVendor.slice(0, TOP),
    salariesHidden: !viewer.salaries,
  };
}
