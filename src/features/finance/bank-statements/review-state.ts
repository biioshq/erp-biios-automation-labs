/**
 * The review screen's rules: which actions fit a line, what each decision still needs before it
 * can be added, the filters, and the CSV of lines not added. Client-safe and pure; the add action
 * checks the same things again on the server.
 */

import { BANK_LINE_ACTIONS, INCOME_CATEGORIES, PROJECT_STAGES, labelOf, type BankLineAction } from "@/lib/constants";
import { toCsv } from "@/features/imports/csv/parse";
import type { LineDecision, ReviewLine, StatementLine, StatementPickers } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const isWithdrawal = (l: StatementLine) => l.withdrawal > 0;
export const amountOf = (l: StatementLine) => (l.withdrawal > 0 ? l.withdrawal : l.deposit);

const OUT_ACTIONS: BankLineAction[] = ["match", "expense", "drawing", "loan_payment", "transfer", "ignore"];
const IN_ACTIONS: BankLineAction[] = ["match", "income", "capital", "loan_received", "transfer", "ignore"];

/** The actions a line can take: money out cannot be income, money in cannot be an expense. */
export function actionsFor(line: ReviewLine): { value: BankLineAction; label: string }[] {
  const allowed = isWithdrawal(line) ? OUT_ACTIONS : IN_ACTIONS;
  return BANK_LINE_ACTIONS.filter((a) => allowed.includes(a.value) && (a.value !== "match" || line.candidates.length > 0));
}

export function actionFits(line: ReviewLine, action: BankLineAction): boolean {
  return actionsFor(line).some((a) => a.value === action);
}

/**
 * The decision after switching a line to another action, with what that action needs filled in
 * from what is known: the first match, the whole amount as principal, the party as lender.
 */
export function withAction(line: ReviewLine, d: LineDecision, action: BankLineAction): LineDecision {
  const next: LineDecision = { ...d, action };
  if (action === "match" && !next.matchKey) next.matchKey = line.candidates[0]?.key;
  if (action === "loan_payment" && next.principal === undefined) {
    next.principal = amountOf(line);
    next.interest = 0;
  }
  if (action === "loan_received" && !next.loanName && next.party) next.loanName = `Loan from ${next.party}`.slice(0, 160);
  if (action === "income" && !next.incomeCategory) next.incomeCategory = "project_payment";
  return next;
}

type ProblemContext = { accountId: string; pickers: StatementPickers };

/** What a decision still needs before the line can be added, or null when it is ready. */
export function decisionProblem(line: ReviewLine, d: LineDecision, ctx: ProblemContext): string | null {
  if (line.imported) return "Imported from an earlier statement";
  if (!actionFits(line, d.action)) return `${labelOf(BANK_LINE_ACTIONS, d.action)} does not fit a ${isWithdrawal(line) ? "withdrawal" : "deposit"}`;
  const amount = amountOf(line);
  switch (d.action) {
    case "ignore":
      return null;
    case "match":
      return d.matchKey && line.candidates.some((c) => c.key === d.matchKey) ? null : "Pick the record it matches";
    case "expense":
      if (!d.party) return "Enter the vendor";
      if (!d.category) return "Pick a category";
      if (d.projectId && !d.stage) return "Pick the project stage";
      return null;
    case "income":
      return d.party ? null : "Enter who paid";
    case "capital":
      return d.holderId ? null : "Pick who put the money in";
    case "drawing": {
      if (!d.holderId) return "Pick the owner";
      const holder = ctx.pickers.holders.find((h) => h.value === d.holderId);
      return holder && holder.kind !== "owner" ? "Drawings are for owners only" : null;
    }
    case "loan_received":
      if (!d.party) return "Enter the lender";
      return d.loanGroup ? null : "Pick the group the loan belongs to";
    case "loan_payment": {
      if (!d.loanId) return "Pick the loan it repays";
      const total = round2((d.principal ?? 0) + (d.interest ?? 0));
      return Math.abs(total - amount) < 0.005 ? null : `Principal and interest add up to ${total.toFixed(2)}, not ${amount.toFixed(2)}`;
    }
    case "transfer":
      if (!d.otherAccountId) return "Pick the other account";
      return d.otherAccountId === ctx.accountId ? "Pick an account other than this statement's" : null;
  }
}

export type ReviewFilter = "all" | "withdrawals" | "deposits" | "new" | "matched" | "attention";

/** Money out and money in are shown as two sections, so the filters only narrow within them. */
export const REVIEW_FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: "all", label: "All lines" },
  { value: "new", label: "New" },
  { value: "matched", label: "Already recorded" },
  { value: "attention", label: "Needs your choice" },
];

/** Where a line's amount goes when it is added, in plain words, for the preview and the confirm. */
export type Destination = "expense" | "bill" | "recorded" | "income" | "capital" | "drawing" | "loan_received" | "loan_payment" | "transfer" | "ignore" | "earlier";

export const DESTINATION_LABELS: Record<Destination, string> = {
  expense: "New expenses",
  bill: "Pays outstanding bills",
  recorded: "Already in the books",
  income: "New income",
  capital: "Capital introduced",
  drawing: "Owner drawings",
  loan_received: "Loans received",
  loan_payment: "Loan repayments",
  transfer: "Transfers between own accounts",
  ignore: "Ignored",
  earlier: "Added from an earlier upload",
};

const DESTINATION_ORDER: Destination[] = ["expense", "bill", "income", "loan_payment", "loan_received", "capital", "drawing", "transfer", "recorded", "ignore", "earlier"];

export function destinationOf(line: ReviewLine, d: LineDecision): Destination {
  if (line.imported) return "earlier";
  if (d.action === "match") return d.matchKey?.startsWith("bill:") ? "bill" : "recorded";
  return d.action;
}

/** Lines grouped by where their money goes, with counts and amounts, in a fixed order. */
export function destinationTotals(rows: { line: ReviewLine; decision: LineDecision }[]): { key: Destination; label: string; count: number; amount: number }[] {
  const by = new Map<Destination, { count: number; amount: number }>();
  for (const r of rows) {
    const k = destinationOf(r.line, r.decision);
    const cur = by.get(k) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += amountOf(r.line);
    by.set(k, cur);
  }
  return DESTINATION_ORDER.filter((k) => by.has(k)).map((k) => ({ key: k, label: DESTINATION_LABELS[k], count: by.get(k)!.count, amount: Math.round(by.get(k)!.amount * 100) / 100 }));
}

export function inFilter(filter: ReviewFilter, line: ReviewLine, d: LineDecision, problem: string | null): boolean {
  switch (filter) {
    case "all":
      return true;
    case "withdrawals":
      return isWithdrawal(line);
    case "deposits":
      return !isWithdrawal(line);
    case "new":
      return !line.imported && d.action !== "match" && d.action !== "ignore";
    case "matched":
      return Boolean(line.imported) || d.action === "match";
    case "attention":
      return !line.imported && (line.attention || problem !== null);
  }
}

/** One line under the action: who, what and where, in a few words. */
export function decisionSummary(line: ReviewLine, d: LineDecision, pickers: StatementPickers): string {
  const name = (list: { value: string; label: string }[], v?: string) => (v ? (list.find((x) => x.value === v)?.label ?? "") : "");
  const project = d.projectId ? [name(pickers.projects, d.projectId), d.stage ? labelOf(PROJECT_STAGES, d.stage) : ""].filter(Boolean).join(", ") : "";
  switch (d.action) {
    case "match":
      return line.candidates.find((c) => c.key === d.matchKey)?.label ?? "";
    case "expense":
      return [d.party, name(pickers.categories, d.category), project].filter(Boolean).join(" · ");
    case "income":
      return [d.party, d.incomeCategory ? labelOf(INCOME_CATEGORIES, d.incomeCategory) : "", project].filter(Boolean).join(" · ");
    case "capital":
    case "drawing":
      return name(pickers.holders, d.holderId);
    case "loan_received":
      return [d.party, name(pickers.liabilityGroups, d.loanGroup)].filter(Boolean).join(" · ");
    case "loan_payment": {
      const loan = name(pickers.loans, d.loanId);
      return loan ? `${loan} · principal ${(d.principal ?? 0).toFixed(2)}, interest ${(d.interest ?? 0).toFixed(2)}` : "";
    }
    case "transfer": {
      const other = name(pickers.accounts, d.otherAccountId);
      return other ? `${isWithdrawal(line) ? "To" : "From"} ${other}` : "";
    }
    case "ignore":
      return "";
  }
}

/** The CSV of lines that were not added, with the reason, to fix and upload again. */
export function notAddedCsv(rows: { line: ReviewLine; reason: string }[]): string {
  const out: (string | number | null)[][] = [["Row", "Date", "Narration", "Reference", "Withdrawal", "Deposit", "Balance", "Reason", "Vendor", "Category"]];
  for (const { line, reason } of rows) {
    out.push([
      line.line,
      line.date,
      line.narration,
      line.reference ?? "",
      line.withdrawal ? line.withdrawal.toFixed(2) : "",
      line.deposit ? line.deposit.toFixed(2) : "",
      line.balance === null ? "" : line.balance.toFixed(2),
      reason,
      line.vendor ?? "",
      line.category ?? "",
    ]);
  }
  return toCsv(out);
}

/** The line as the actions take it: within each field's limit, so the server hashes what it was sent. */
export function toWire(l: StatementLine): StatementLine {
  return {
    line: l.line,
    page: l.page,
    date: l.date,
    valueDate: l.valueDate,
    narration: l.narration.slice(0, 1000).trim(),
    reference: l.reference?.slice(0, 120).trim() || undefined,
    withdrawal: l.withdrawal,
    deposit: l.deposit,
    balance: l.balance,
    check: l.check,
    issues: l.issues.slice(0, 10).map((i) => i.slice(0, 300)),
    vendor: l.vendor?.slice(0, 200).trim() || undefined,
    category: l.category?.slice(0, 80).trim() || undefined,
  };
}

/** The decision as the add action takes it: text within each field's limit. */
export function wireDecision(d: LineDecision): LineDecision {
  return { ...d, party: d.party?.trim().slice(0, 200), description: d.description?.trim().slice(0, 1000), loanName: d.loanName?.trim().slice(0, 160) };
}
