import "server-only";

import { connectDB } from "@/server/db";
import { salaryScope } from "@/server/auth/session";
import { Expense, Invoice, Project } from "@/server/models";
import { budgetUsage, projectSpend } from "@/server/services/metrics";
import { cashFlow, periodFromInputs } from "@/server/accounting/statements";
import { invoiceBalances, liabilityRows, payablesSummary, receivablesSummary } from "@/server/finance/summaries";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { LIABILITY_STATUSES, PAYMENT_STATUSES, PROJECT_STAGES, PROJECT_STATUSES, labelOf } from "@/lib/constants";
import type { LiabilityStatus, PaymentStatus, ProjectStatus } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { formatCurrency, formatDate, round2 } from "@/lib/format";
import { col, objectIds, periodText, sumTotals } from "../common";
import { daysOverdue } from "./statement-rows";
import type { ReportColumn, ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/**
 * Project financials (profitability, budget against actual, cost by category) and the cash flow
 * and budget report (cash in and out, cash position, what is due to be paid and received).
 * Spend and income per project come from src/server/services/metrics.ts, cash from the cash flow
 * statement, open items from src/server/finance/summaries.ts. Nothing here is a forecast: expected
 * payments and receipts are the bills, loans and invoices already recorded.
 */

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/* Project financials */

export async function buildProjectFinancialsReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const only = new Set(f.project.filter((p) => p !== "none"));
  // A filter that names no real project ("No project" alone) matches no project row, as in the Project report.
  const usage = (await budgetUsage()).filter((p) => !f.project.length || only.has(p.id));
  const ids = usage.map((u) => u.id);
  const scope = await salaryScope();
  const [spend, docs, invoiced, balances, costs, categoryLabel] = await Promise.all([
    projectSpend(ids),
    Project.find({ _id: { $in: objectIds(ids) } }, { client: 1, contractValue: 1, stageBudgets: 1, budgetHistory: 1 }).lean(),
    Invoice.aggregate<{ _id: unknown; total: number; taxable: number }>([
      { $match: { project: { $in: objectIds(ids) }, status: { $ne: "cancelled" } } },
      { $group: { _id: "$project", total: { $sum: "$total" }, taxable: { $sum: "$taxableAmount" } } },
    ]),
    invoiceBalances(new Date(), { project: { $in: objectIds(ids) } }),
    // Same records as the project's spend (stock counted at purchase included), salaries hidden for members.
    Expense.aggregate<{ _id: { project: unknown; category: string }; total: number }>([
      { $match: { project: { $in: objectIds(ids) }, ...scope } },
      { $group: { _id: { project: "$project", category: "$category" }, total: { $sum: "$amount" } } },
    ]),
    getExpenseCategoryLabeler(),
  ]);
  const meta = new Map(docs.map((d) => [String(d._id), d]));
  const invoicedBy = new Map(invoiced.map((i) => [String(i._id), round2(i.total)]));
  const receivableBy = new Map<string, number>();
  for (const b of balances) if (b.project) receivableBy.set(b.project, round2((receivableBy.get(b.project) ?? 0) + b.outstanding));
  const projects = [...usage].sort((a, b) => a.code.localeCompare(b.code));

  const profitColumns: ReportColumn[] = [
    col("code", "Code", "text", 10),
    col("name", "Project", "text", 24),
    col("client", "Client", "text", 18),
    col("status", "Status", "text", 11),
    col("contract", "Contract value", "money", 15),
    col("invoiced", "Invoiced", "money", 15),
    col("income", "Income received", "money", 15),
    col("receivable", "Still to receive", "money", 15),
    col("spent", "Spent", "money", 15),
    col("profit", "Profit", "money", 15),
    col("margin", "Margin", "percent", 9),
  ];
  const profitRows: ReportRow[] = projects.map((p) => {
    const income = spend.get(p.id)?.income ?? 0;
    const profit = round2(income - p.spent);
    return {
      code: p.code,
      name: p.name,
      client: meta.get(p.id)?.client ?? "",
      status: labelOf(PROJECT_STATUSES, p.status as ProjectStatus),
      contract: meta.get(p.id)?.contractValue ?? null,
      invoiced: invoicedBy.get(p.id) ?? 0,
      income,
      receivable: receivableBy.get(p.id) ?? 0,
      spent: p.spent,
      profit,
      margin: ratio(profit, income),
    };
  });
  const profitTotals = sumTotals(profitColumns, profitRows);
  profitTotals.margin = ratio(Number(profitTotals.profit), Number(profitTotals.income));
  const profitability: ReportSection = { title: "Profitability", columns: profitColumns, rows: profitRows, totals: profitTotals };

  const budgetColumns: ReportColumn[] = [
    col("code", "Code", "text", 10),
    col("name", "Project", "text", 26),
    col("original", "Original budget", "money", 15),
    col("budget", "Current budget", "money", 15),
    col("spent", "Actual spend", "money", 15),
    col("variance", "Variance (budget less actual)", "money", 15),
    col("usage", "Budget used", "percent", 10),
  ];
  const budgetRows: ReportRow[] = projects.map((p) => {
    const history = meta.get(p.id)?.budgetHistory;
    return {
      code: p.code,
      name: p.name,
      original: history?.length ? history[0].budget : p.budget,
      budget: p.budget,
      spent: p.spent,
      variance: p.remaining,
      usage: p.budget > 0 ? p.usage : null,
    };
  });
  const budgetTotals = sumTotals(budgetColumns, budgetRows);
  budgetTotals.usage = ratio(Number(budgetTotals.spent), Number(budgetTotals.budget));
  const budgets: ReportSection = { title: "Budget against actual", columns: budgetColumns, rows: budgetRows, totals: budgetTotals };

  const stageColumns: ReportColumn[] = [
    col("project", "Project", "text", 26),
    col("stage", "Stage", "text", 18),
    col("planned", "Planned", "money", 15),
    col("actual", "Actual", "money", 15),
    col("variance", "Variance (planned less actual)", "money", 15),
  ];
  const stageRows: ReportRow[] = [];
  for (const p of projects) {
    const planned = (meta.get(p.id)?.stageBudgets ?? {}) as Partial<Record<string, number>>;
    const byStage = spend.get(p.id)?.byStage;
    for (const st of PROJECT_STAGES) {
      const plan = round2(planned[st.value] ?? 0);
      const actual = byStage?.[st.value] ?? 0;
      if (!plan && !actual) continue;
      stageRows.push({ project: `${p.code} ${p.name}`, stage: st.label, planned: plan, actual, variance: round2(plan - actual) });
    }
  }
  const stages: ReportSection = { title: "Budget by stage", columns: stageColumns, rows: stageRows, totals: sumTotals(stageColumns, stageRows) };

  const costColumns: ReportColumn[] = [col("project", "Project", "text", 28), col("category", "Category", "text", 24), col("amount", "Amount", "money", 16), col("share", "Share of project spend", "percent", 12)];
  const nameOf = new Map(projects.map((p) => [p.id, `${p.code} ${p.name}`]));
  const spentOf = new Map(projects.map((p) => [p.id, p.spent]));
  const costRows: ReportRow[] = costs
    .map((c) => ({ id: String(c._id.project), category: c._id.category, amount: round2(c.total) }))
    .sort((a, b) => (nameOf.get(a.id) ?? "").localeCompare(nameOf.get(b.id) ?? "") || b.amount - a.amount)
    .map((c) => ({ project: nameOf.get(c.id) ?? "", category: categoryLabel(c.category), amount: c.amount, share: ratio(c.amount, spentOf.get(c.id) ?? 0) }));
  const costSection: ReportSection = { title: "Cost by category", columns: costColumns, rows: costRows, totals: sumTotals(costColumns, costRows) };

  const overBudget = budgetRows.filter((r) => Number(r.variance) < 0).length;
  return {
    type: "project_financials",
    subtitle: [
      `Lifetime figures as of ${formatDate(new Date())}`,
      only.size ? `${projects.length} selected projects` : "",
      "Profit is income received less spend (stock assigned or bought for the project included)",
      usage.some((u) => u.salariesHidden) ? "Salaries are hidden from spend for your role" : "",
    ]
      .filter(Boolean)
      .join(" · "),
    summary: [
      { label: "Projects", value: projects.length, type: "number" },
      { label: "Income received", value: Number(profitTotals.income), type: "money" },
      { label: "Spent", value: Number(profitTotals.spent), type: "money" },
      { label: "Profit", value: Number(profitTotals.profit), type: "money" },
      { label: "Over budget", value: overBudget, type: "number" },
    ],
    ...profitability,
    title: "Project financials report",
    sections: [profitability, budgets, stages, costSection],
  };
}

/* Cash flow and budget */

export async function buildCashBudgetReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const now = new Date();
  const today = toDateInput(now);
  const period = periodFromInputs(f.from, f.to);
  const [cf, payables, receivables, loans, usage] = await Promise.all([
    cashFlow(period.from, period.to),
    payablesSummary(now),
    receivablesSummary(now),
    liabilityRows(now),
    budgetUsage(),
  ]);
  const openLoans = loans.filter((l) => l.outstanding > 0);
  const loanTotal = round2(openLoans.reduce((s, l) => s + l.outstanding, 0));

  // Every cash line of the statement, split into money in and money out.
  const lines = cf.activities.flatMap((a) => a.lines.map((l) => ({ activity: a.label, label: l.label, amount: l.amount })));
  const inflow = round2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const outflow = round2(-lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0));
  const endsToday = cf.to === today;

  const summaryColumns = [col("line", "Line", "text", 46), col("amount", "Amount", "money", 18)];
  const summaryRows: ReportRow[] = [
    { line: "Cash at the start of the period", amount: cf.opening, _kind: "subtotal" },
    { line: "Cash inflow", amount: null, _kind: "subtotal" },
    ...lines.filter((l) => l.amount > 0).map((l) => ({ line: `    ${l.label}`, amount: l.amount })),
    { line: "Total cash inflow", amount: inflow, _kind: "subtotal" },
    { line: "Cash outflow", amount: null, _kind: "subtotal" },
    ...lines.filter((l) => l.amount < 0).map((l) => ({ line: `    ${l.label}`, amount: round2(-l.amount) })),
    { line: "Total cash outflow", amount: outflow, _kind: "subtotal" },
    { line: "Cash at the end of the period", amount: cf.closing, _kind: "subtotal" },
    { line: "Recorded open items (as of today)", amount: null, _kind: "subtotal" },
    { line: "    Expected receipts: open invoices", amount: receivables.total },
    { line: "    Expected payments: vendor bills", amount: payables.total },
    { line: "    Expected payments: loans outstanding", amount: loanTotal },
    ...(endsToday
      ? [{ line: "Cash if every recorded open item were settled", amount: round2(cf.closing + receivables.total - payables.total - loanTotal), _kind: "subtotal" as const }]
      : []),
  ];
  const summarySection: ReportSection = { title: "Cash summary", columns: summaryColumns, rows: summaryRows, totals: null };

  const accountColumns = [
    col("account", "Account", "text", 30),
    col("opening", "Opening", "money", 16),
    col("inflow", "Money in", "money", 16),
    col("outflow", "Money out", "money", 16),
    col("closing", "Closing", "money", 16),
  ];
  const accountRows: ReportRow[] = cf.accounts.map((a) => ({ account: a.name, opening: a.opening, inflow: a.inflow, outflow: a.outflow, closing: a.closing }));
  const accounts: ReportSection = { title: "Cash position by account", columns: accountColumns, rows: accountRows, totals: sumTotals(accountColumns, accountRows) };

  const payColumns: ReportColumn[] = [
    col("kind", "Type", "text", 11),
    col("ref", "Reference", "text", 13),
    col("party", "Pay to", "text", 24),
    col("due", "Due", "date", 12),
    col("amount", "Amount due", "money", 16),
    col("status", "Status", "text", 11),
    col("late", "Days overdue", "number", 9),
    col("note", "Note", "text", 26),
  ];
  const payRows: ReportRow[] = [
    ...payables.rows.map((b) => ({
      kind: "Vendor bill",
      ref: b.number,
      party: b.vendor,
      due: b.dueDate,
      amount: b.outstanding,
      status: labelOf(PAYMENT_STATUSES, b.status as PaymentStatus),
      late: b.status === "overdue" ? daysOverdue(b.dueDate, today) : null,
      note: b.paid > 0 ? `Part paid: ${formatCurrency(b.paid, { exact: true })} of ${formatCurrency(b.amount, { exact: true })}` : "",
    })),
    ...openLoans.map((l) => ({
      kind: "Loan",
      ref: l.code,
      party: l.lender,
      due: l.dueDate,
      amount: l.outstanding,
      status: labelOf(LIABILITY_STATUSES, l.status as LiabilityStatus),
      late: l.status === "overdue" ? daysOverdue(l.dueDate, today) : null,
      // Instalment dates are not recorded: the loan's own due date and full balance are shown.
      note: `${l.name}: full balance on the loan's due date`,
    })),
  ].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const payments: ReportSection = { title: "Expected payments", columns: payColumns, rows: payRows, totals: sumTotals(payColumns, payRows) };

  const receiveColumns: ReportColumn[] = [
    col("ref", "Invoice", "text", 14),
    col("party", "Customer", "text", 26),
    col("due", "Due", "date", 12),
    col("total", "Invoice total", "money", 15),
    col("amount", "Still to receive", "money", 16),
    col("status", "Status", "text", 11),
    col("late", "Days overdue", "number", 9),
  ];
  const receiveRows: ReportRow[] = receivables.rows
    .map((r) => ({
      ref: r.number,
      party: r.client,
      due: r.dueDate,
      total: r.total,
      amount: r.outstanding,
      status: labelOf(PAYMENT_STATUSES, r.status as PaymentStatus),
      late: r.status === "overdue" ? daysOverdue(r.dueDate, today) : null,
    }))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const receipts: ReportSection = { title: "Expected receipts", columns: receiveColumns, rows: receiveRows, totals: sumTotals(receiveColumns, receiveRows) };

  const budgetColumns: ReportColumn[] = [
    col("code", "Code", "text", 10),
    col("name", "Project", "text", 26),
    col("status", "Status", "text", 11),
    col("budget", "Budget allocated", "money", 16),
    col("spent", "Actual spend", "money", 16),
    col("variance", "Variance (budget less actual)", "money", 16),
    col("usage", "Budget used", "percent", 10),
  ];
  const budgetRows: ReportRow[] = [...usage]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => ({
      code: p.code,
      name: p.name,
      status: labelOf(PROJECT_STATUSES, p.status as ProjectStatus),
      budget: p.budget,
      spent: p.spent,
      variance: p.remaining,
      usage: p.budget > 0 ? p.usage : null,
    }));
  const budgetTotals = sumTotals(budgetColumns, budgetRows);
  budgetTotals.usage = ratio(Number(budgetTotals.spent), Number(budgetTotals.budget));
  const budgets: ReportSection = { title: "Budget against actual", columns: budgetColumns, rows: budgetRows, totals: budgetTotals };

  return {
    type: "cash_budget",
    subtitle: [
      `Period: ${periodText({ from: cf.from, to: cf.to })}`,
      "Expected payments and receipts are the bills, loans and invoices recorded today, not a forecast",
      "Loan instalment dates are not recorded, so each loan shows its full balance on its due date",
      "Budgets against lifetime spend",
    ].join(" · "),
    statement: true,
    summary: [
      { label: "Opening cash", value: cf.opening, type: "money" },
      { label: "Cash inflow", value: inflow, type: "money" },
      { label: "Cash outflow", value: outflow, type: "money" },
      { label: "Closing cash", value: cf.closing, type: "money" },
      { label: "Expected receipts", value: receivables.total, type: "money" },
      { label: "Expected payments", value: round2(payables.total + loanTotal), type: "money" },
    ],
    ...summarySection,
    title: "Cash flow and budget report",
    sections: [summarySection, accounts, payments, receipts, budgets],
  };
}
