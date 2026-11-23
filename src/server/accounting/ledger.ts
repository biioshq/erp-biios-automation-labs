import "server-only";

import { cache } from "react";
import { connectDB } from "@/server/db";
import {
  AccountTransfer,
  CapitalEntry,
  EquityHolder,
  Expense,
  ExpenseCategorySetting,
  FinanceGroup,
  FixedAsset,
  Income,
  InventoryMovement,
  Investment,
  Invoice,
  Liability,
  Project,
} from "@/server/models";
import { loadAccountBook, type AccountBook } from "@/server/accounts";
import { loadExpenseCategories } from "@/server/expense-categories";
import { expenseCategoryLabel } from "@/lib/expense-categories";
import { effectivePayments } from "@/lib/payments";
import { depreciationSchedule } from "@/lib/depreciation";
import { builtInGroup, builtInAncestors } from "@/lib/finance-groups";
import { defaultNature } from "@/lib/expense-nature";
import { INCOME_CATEGORIES, labelOf, type ExpenseNature, type IncomeCategory } from "@/lib/constants";
import { endOfDayIST, startOfDayIST, startOfMonthIST } from "@/lib/dates";
import type { CashActivity, LedgerAccountMeta, PlSection, Posting, PostingSource } from "@/lib/accounting";

/**
 * The books, computed. Every record the ERP keeps is read as the two sides of what it did (a debit
 * and a credit), so the trial balance, balance sheet, profit & loss and cash flow all come from the
 * same records and always balance. Nothing here is stored and nothing is written.
 *
 * How each record is read (the rules agreed for this ERP):
 *  - Expense: its cost (less GST input credit) is an expense of its category, owed to the supplier
 *    (accounts payable); each payment, explicit or implied (src/lib/payments.ts), settles that from
 *    a cash or bank account. Stock purchases cost Inventory instead; an expense that paid for a
 *    fixed asset costs that asset; a prepaid expense is spread over the days it covers.
 *    Generated stock-assignment and wastage expenses are skipped: the stock movements carry them.
 *  - Stock is an asset until used: assigning it to a project moves its cost into materials
 *    consumed, returns move it back, adjustments and wastage from storage are write-offs. Stock
 *    entered as already on hand is part of the opening balances.
 *  - Income received: revenue of its category, or a settlement of the invoice it is linked to.
 *    Advances are a liability (customer advances) until linked to an invoice or until their project
 *    is completed. Invoices are revenue (and output GST) on their date.
 *  - Capital, drawings, dividends and reserves move equity only; loans are liabilities (only their
 *    interest is an expense, booked by the loan as an expense record); investments and fixed assets
 *    are assets, with depreciation accrued month by month up to the day asked for.
 *  - Cash and bank accounts start from their opening balance; records dated before an account's
 *    opening date are history already in that balance, so their cash side goes to opening equity.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005;

type Line = [account: string, amount: number, cf?: { activity: CashActivity; line: string }, memo?: string];

export type Ledger = {
  asOf: Date;
  postings: Posting[];
  accounts: Map<string, LedgerAccountMeta>;
  book: AccountBook;
};

/** The last moment the books are computed for: the end of `to`'s IST day, never later than today. */
export function effectiveAsOf(to?: Date | null): Date {
  const today = endOfDayIST(new Date());
  if (!to) return today;
  const end = endOfDayIST(to);
  return end.getTime() > today.getTime() ? today : end;
}

const INCOME_OTHER = new Set<IncomeCategory>(["grant", "other"]);
const DIRECT_LINE = "Payments to suppliers and for expenses";

/** Builds the postings of every record dated up to `asOf` (inclusive). */
async function buildLedger(asOfInput?: Date | null): Promise<Ledger> {
  await connectDB();
  const asOf = effectiveAsOf(asOfInput);
  const upTo = { $lte: asOf };

  const [
    book,
    categories,
    natureSettings,
    groups,
    expenses,
    incomes,
    invoices,
    movements,
    assets,
    investments,
    liabilities,
    entries,
    holders,
    transfers,
    projects,
  ] = await Promise.all([
    loadAccountBook(),
    loadExpenseCategories(),
    ExpenseCategorySetting.find({ nature: { $exists: true } }, { value: 1, nature: 1 }).lean(),
    FinanceGroup.find({}, { kind: 1, parent: 1, name: 1 }).lean(),
    Expense.find(
      { countedAtPurchase: { $ne: true }, source: { $nin: ["inventory_assignment", "inventory_wastage"] }, date: upTo },
      {
        number: 1,
        vendor: 1,
        category: 1,
        amount: 1,
        date: 1,
        paymentMethod: 1,
        account: 1,
        payments: 1,
        gst: 1,
        source: 1,
        movement: 1,
        capitalAsset: 1,
        prepaid: 1,
        project: 1,
        liability: 1,
      },
    ).lean(),
    Income.find({ date: upTo }, { number: 1, client: 1, amount: 1, date: 1, category: 1, paymentMethod: 1, account: 1, invoice: 1, project: 1 }).lean(),
    Invoice.find({ status: { $ne: "cancelled" } }, { number: 1, client: 1, date: 1, taxableAmount: 1, cgst: 1, sgst: 1, igst: 1, total: 1, project: 1 }).lean(),
    InventoryMovement.find({ date: upTo }, { type: 1, totalCost: 1, availableDelta: 1, expense: 1, date: 1, wastage: 1, item: 1, note: 1 }).lean(),
    FixedAsset.find({ purchaseDate: upTo }).lean(),
    Investment.find({ purchaseDate: upTo }).lean(),
    Liability.find({ date: upTo }).lean(),
    CapitalEntry.find({ date: upTo }).lean(),
    EquityHolder.find({}, { kind: 1, name: 1 }).lean(),
    AccountTransfer.find({ date: upTo }).lean(),
    Project.find({}, { status: 1, endDate: 1, updatedAt: 1, name: 1 }).lean(),
  ]);

  const postings: Posting[] = [];
  const accounts = new Map<string, LedgerAccountMeta>();
  const natureOf = new Map<string, ExpenseNature>(natureSettings.map((s) => [s.value, s.nature as ExpenseNature]));
  const subgroupName = new Map(groups.map((g) => [String(g._id), g.name]));
  const holderKind = new Map(holders.map((h) => [String(h._id), h.kind]));
  const movementById = new Map(movements.map((m) => [String(m._id), m]));
  const invoiceById = new Map(invoices.map((i) => [String(i._id), i]));
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const assetById = new Map(assets.map((a) => [String(a._id), a]));
  // The expense that paid for each asset (either side of the link counts).
  const assetByExpense = new Map<string, (typeof assets)[number]>();
  for (const a of assets) if (a.funding?.mode === "expense" && a.funding.expense) assetByExpense.set(String(a.funding.expense), a);
  const loadedExpenses = new Set(expenses.map((e) => String(e._id)));

  const groupLabel = (key: string) => builtInGroup(key)?.label ?? subgroupName.get(key) ?? key;

  /** Registers an account's metadata the first time it is used. */
  const ensure = (code: string) => {
    if (accounts.has(code)) return;
    const colon = code.indexOf(":");
    const prefix = colon < 0 ? code : code.slice(0, colon);
    const rest = colon < 0 ? "" : code.slice(colon + 1);
    let meta: LedgerAccountMeta;
    switch (prefix) {
      case "cash": {
        const a = book.byCode.get(code);
        meta = { code, name: a?.name ?? "Cash", type: "asset", group: "cash_equivalents", cash: true };
        break;
      }
      case "fa":
        meta = { code, name: groupLabel(rest), type: "asset", group: rest };
        break;
      case "fa_dep":
        meta = { code, name: `Accumulated depreciation: ${groupLabel(rest)}`, type: "asset", group: rest, contra: true };
        break;
      case "inv":
        meta = { code, name: groupLabel(rest), type: "asset", group: rest };
        break;
      case "liab":
        meta = { code, name: groupLabel(rest), type: "liability", group: rest };
        break;
      case "reserve":
        meta = { code, name: groupLabel(rest), type: "equity", group: rest };
        break;
      case "rev":
        meta = rest === "invoices"
          ? { code, name: "Sales and services invoiced", type: "income", pl: "revenue" }
          : rest === "advances"
            ? { code, name: "Advances earned", type: "income", pl: "revenue" }
            : {
                code,
                name: labelOf(INCOME_CATEGORIES, rest as IncomeCategory) || rest,
                type: "income",
                pl: INCOME_OTHER.has(rest as IncomeCategory) ? "other_income" : "revenue",
              };
        break;
      case "exp": {
        const nature = natureOf.get(rest) ?? defaultNature(rest);
        const pl: PlSection = rest === "interest" ? "finance" : nature;
        meta = { code, name: expenseCategoryLabel(categories, rest), type: "expense", pl };
        break;
      }
      case "dep":
        meta = { code, name: `Depreciation: ${groupLabel(rest)}`, type: "expense", pl: "depreciation" };
        break;
      default:
        meta = FIXED_ACCOUNTS[code] ?? { code, name: code, type: "expense", pl: "indirect" };
    }
    accounts.set(code, { ...meta, code });
  };

  /** Records one balanced entry. Any rounding left over goes to the rounding account. */
  const post = (date: Date, source: PostingSource, lines: Line[]) => {
    let sum = 0;
    for (const [account, raw, cf, memo] of lines) {
      const amount = round2(raw);
      if (Math.abs(amount) < EPS) continue;
      ensure(account);
      postings.push({ date, account, amount, source, ...(memo ? { memo } : {}), ...(cf ? { cf } : {}) });
      sum += amount;
    }
    sum = round2(sum);
    if (Math.abs(sum) >= EPS) {
      ensure("rounding");
      postings.push({ date, account: "rounding", amount: -sum, source, memo: "Rounding" });
    }
  };

  /**
   * The cash side of a record: the account its method and account point to, or opening equity
   * when the record predates that account's opening balance. Null for stock (no money moves).
   */
  const cashSide = (method: string | null | undefined, accountId: unknown, date: Date): string | null => {
    const code = book.resolve(method, accountId);
    if (!code) return null;
    const account = book.byCode.get(code);
    if (account?.openingDate && date.getTime() < account.openingDate.getTime()) return "opening_equity";
    return code;
  };
  const cf = (activity: CashActivity, line: string) => ({ activity, line });

  // Opening balances of cash and bank accounts.
  for (const a of book.accounts) {
    if (!a.id || !a.openingDate || a.openingDate.getTime() > asOf.getTime() || !a.openingBalance) continue;
    post(a.openingDate, { kind: "bank_account", id: a.id, label: `Opening balance, ${a.name}` }, [
      [a.code, a.openingBalance, cf("internal", "Opening balance")],
      ["opening_equity", -a.openingBalance],
    ]);
  }

  // Expenses and their payments.
  for (const e of expenses) {
    const id = String(e._id);
    const source: PostingSource = { kind: "expense", id, label: `${e.number} ${e.vendor}`, href: `/finance/expenses?view=${id}` };
    const tax = round2((e.gst?.cgst ?? 0) + (e.gst?.sgst ?? 0) + (e.gst?.igst ?? 0) + (e.gst?.cess ?? 0));
    const gst = Math.min(Math.max(0, tax), e.amount);
    const net = round2(e.amount - gst);
    const lines: Line[] = [];
    let activity: CashActivity = "operating";
    let line = DIRECT_LINE;

    if (e.source === "inventory_purchase") {
      const m = e.movement ? movementById.get(String(e.movement)) : undefined;
      const stock = m ? Math.min(m.totalCost ?? net, e.amount) : net;
      lines.push(["inventory", stock], ["gst_input", gst], ["purchase_difference", e.amount - stock - gst]);
      line = "Payments for stock purchases";
    } else if (assetByExpense.has(id) || (e.capitalAsset && assetById.has(String(e.capitalAsset)))) {
      const asset = assetByExpense.get(id) ?? assetById.get(String(e.capitalAsset))!;
      const cost = Math.min(asset.purchaseCost, e.amount);
      lines.push([`fa:${asset.group}`, cost], ["gst_input", Math.min(gst, e.amount - cost)], ["purchase_difference", e.amount - cost - Math.min(gst, e.amount - cost)]);
      activity = "investing";
      line = "Purchase of fixed assets";
    } else if (e.prepaid?.from && e.prepaid?.to) {
      lines.push(["prepaid", net], ["gst_input", gst]);
      // Spread over the days it covers, up to the day asked for.
      for (const piece of spread(net, e.prepaid.from, e.prepaid.to, asOf)) {
        post(piece.date, { kind: "accrual", id, label: `${e.number} ${e.vendor}: prepaid expense used`, href: source.href }, [
          [`exp:${e.category}`, piece.amount],
          ["prepaid", -piece.amount],
        ]);
      }
    } else {
      lines.push([`exp:${e.category}`, net], ["gst_input", gst]);
      if (e.source === "liability_interest" || e.category === "interest") {
        activity = e.source === "liability_interest" ? "financing" : "operating";
        line = e.source === "liability_interest" ? "Interest paid" : DIRECT_LINE;
      }
    }
    lines.push(["ap", -e.amount]);
    post(e.date, source, lines);

    for (const [i, p] of effectivePayments(e).entries()) {
      const date = new Date(p.date);
      if (date.getTime() > asOf.getTime()) continue;
      const cash = cashSide(p.paymentMethod, p.account ?? (Array.isArray(e.payments) ? undefined : e.account), date);
      if (!cash) continue;
      post(date, { kind: "expense_payment", id: `${id}:${i}`, label: `Payment, ${e.number} ${e.vendor}`, href: source.href }, [
        ["ap", p.amount],
        [cash, -p.amount, cash.startsWith("cash:") ? cf(activity, line) : undefined],
      ]);
    }
  }

  // Stock movements: stock is an asset until it is used, wasted or adjusted.
  for (const m of movements) {
    const value = Math.abs(m.totalCost ?? 0);
    if (!value) continue;
    const id = String(m._id);
    const source: PostingSource = { kind: "movement", id, label: movementLabel(m.type), href: `/inventory/items/${m.item}` };
    switch (m.type) {
      case "purchase":
        // A bought purchase is booked by its expense; stock entered as already on hand is an opening balance.
        if (!m.expense) post(m.date, source, [["inventory", value], ["opening_equity", -value]]);
        break;
      case "assign":
        post(m.date, source, [["materials_consumed", value], ["inventory", -value]]);
        break;
      case "return":
        post(m.date, source, [["inventory", value], ["materials_consumed", -value]]);
        break;
      case "adjustment":
        post(m.date, source, (m.availableDelta ?? 0) < 0 ? [["stock_adjustments", value], ["inventory", -value]] : [["inventory", value], ["stock_adjustments", -value]]);
        break;
      case "wastage":
        // Stock wasted while in use on a project was already that project's cost when it was assigned.
        if (m.wastage?.from !== "project") post(m.date, source, [["stock_written_off", value], ["inventory", -value]]);
        break;
      default:
        break;
    }
  }

  // Invoices: revenue and output GST on their date; the customer owes the total.
  const invoiceDate = new Map<string, Date>();
  for (const inv of invoices) {
    invoiceDate.set(String(inv._id), inv.date);
    if (inv.date.getTime() > asOf.getTime()) continue;
    const tax = round2((inv.cgst ?? 0) + (inv.sgst ?? 0) + (inv.igst ?? 0));
    post(inv.date, { kind: "invoice", id: String(inv._id), label: `Invoice ${inv.number} ${inv.client}`, href: `/finance/invoices?view=${inv._id}` }, [
      ["receivables", inv.total],
      ["rev:invoices", -(inv.total - tax)],
      ["gst_output", -tax],
    ]);
  }

  // Income received.
  for (const r of incomes) {
    const id = String(r._id);
    const source: PostingSource = { kind: "income", id, label: `${r.number} ${r.client}`, href: `/finance/income?view=${id}` };
    const cash = cashSide(r.paymentMethod, r.account, r.date);
    if (!cash) continue;
    const inflow = (line: string) => (cash.startsWith("cash:") ? cf("operating", line) : undefined);
    const invoiceId = r.invoice ? String(r.invoice) : null;
    const invDate = invoiceId ? invoiceDate.get(invoiceId) : undefined;
    if (invoiceId && invDate) {
      if (invDate.getTime() <= r.date.getTime()) {
        post(r.date, source, [[cash, r.amount, inflow("Receipts from customers")], ["receivables", -r.amount]]);
      } else {
        // Received before the invoice was raised: an advance until the invoice date.
        post(r.date, source, [[cash, r.amount, inflow("Advances received from customers")], ["customer_advances", -r.amount]]);
        if (invDate.getTime() <= asOf.getTime()) post(invDate, { ...source, label: `${r.number} applied to ${invoiceById.get(invoiceId)?.number ?? "invoice"}` }, [["customer_advances", r.amount], ["receivables", -r.amount]]);
      }
    } else if (r.category === "advance") {
      post(r.date, source, [[cash, r.amount, inflow("Advances received from customers")], ["customer_advances", -r.amount]]);
      // Earned when its project is completed.
      const p = r.project ? projectById.get(String(r.project)) : undefined;
      if (p?.status === "completed") {
        const done = new Date(Math.max(r.date.getTime(), new Date(p.endDate ?? p.updatedAt ?? r.date).getTime()));
        if (done.getTime() <= asOf.getTime()) post(done, { ...source, label: `${r.number} advance earned (${p.name} completed)` }, [["customer_advances", r.amount], ["rev:advances", -r.amount]]);
      }
    } else {
      post(r.date, source, [[cash, r.amount, inflow(INCOME_OTHER.has(r.category as IncomeCategory) ? "Other receipts" : "Receipts from customers")], [`rev:${r.category ?? "other"}`, -r.amount]]);
    }
  }

  // Fixed and intangible assets: purchase, depreciation month by month, disposal.
  for (const a of assets) {
    const id = String(a._id);
    const source: PostingSource = { kind: "fixed_asset", id, label: `${a.code} ${a.name}`, href: `/finance/assets/fixed?view=${id}` };
    const cost = a.purchaseCost ?? 0;
    const mode = a.funding?.mode;
    if (mode === "paid") {
      const cash = cashSide(a.funding?.paymentMethod ?? "bank_transfer", a.funding?.account, a.purchaseDate) ?? "opening_equity";
      post(a.purchaseDate, source, [[`fa:${a.group}`, cost], [cash, -cost, cash.startsWith("cash:") ? cf("investing", "Purchase of fixed assets") : undefined]]);
    } else if (mode === "opening") {
      post(a.purchaseDate, source, [[`fa:${a.group}`, cost], ["opening_equity", -cost]]);
    } else if (mode === "expense" && !(a.funding?.expense && loadedExpenses.has(String(a.funding.expense)))) {
      // The expense it names is not in these books: dated after the day asked for (then the asset is
      // not bought yet either) or deleted (then the asset is carried at cost against opening equity).
      const exists = a.funding?.expense ? await Expense.exists({ _id: a.funding.expense }) : null;
      if (!exists) post(a.purchaseDate, source, [[`fa:${a.group}`, cost], ["opening_equity", -cost]]);
      else continue;
    }
    for (const d of depreciationSchedule(a, asOf)) {
      const date = monthEnd(d.month, asOf);
      post(date, { kind: "accrual", id, label: `${a.code} ${a.name}: depreciation ${d.month}`, href: source.href }, [
        [`dep:${a.group}`, d.amount],
        [`fa_dep:${a.group}`, -d.amount],
      ]);
    }
    if (a.disposal?.date && a.disposal.date.getTime() <= asOf.getTime()) {
      const accumulated = round2(depreciationSchedule(a, a.disposal.date).reduce((s, d) => s + d.amount, 0));
      const proceeds = a.disposal.amount ?? 0;
      const cash = proceeds > 0 ? cashSide("bank_transfer", a.disposal.account, a.disposal.date) ?? "opening_equity" : null;
      const result = round2(proceeds - (cost - accumulated));
      post(a.disposal.date, { ...source, label: `${a.code} ${a.name} disposed` }, [
        ...(cash ? [[cash, proceeds, cash.startsWith("cash:") ? cf("investing", "Sale of fixed assets") : undefined] as Line] : []),
        [`fa_dep:${a.group}`, accumulated],
        [`fa:${a.group}`, -cost],
        [result >= 0 ? "gain_on_disposal" : "loss_on_disposal", -result],
      ]);
    }
  }

  // Investments.
  for (const v of investments) {
    const id = String(v._id);
    const source: PostingSource = { kind: "investment", id, label: v.name, href: `/finance/assets/investments?view=${id}` };
    const cash = v.account ? cashSide("bank_transfer", v.account, v.purchaseDate) ?? "opening_equity" : "opening_equity";
    post(v.purchaseDate, source, [[`inv:${v.group}`, v.amount], [cash, -v.amount, cash.startsWith("cash:") ? cf("investing", "Investments made") : undefined]]);
    if (v.redemption?.date && v.redemption.date.getTime() <= asOf.getTime()) {
      const back = cashSide("bank_transfer", v.redemption.account, v.redemption.date) ?? "opening_equity";
      const result = round2(v.redemption.amount - v.amount);
      post(v.redemption.date, { ...source, label: `${v.name} redeemed` }, [
        [back, v.redemption.amount, back.startsWith("cash:") ? cf("investing", "Investments redeemed") : undefined],
        [`inv:${v.group}`, -v.amount],
        [result >= 0 ? "investment_gain" : "investment_loss", -result],
      ]);
    }
  }

  // Loans and other liabilities: taken on, then repaid (interest is booked by its own expense record).
  for (const l of liabilities) {
    const id = String(l._id);
    const source: PostingSource = { kind: "liability", id, label: `${l.code} ${l.name}`, href: `/finance/liabilities/loans?view=${id}` };
    const into = l.source?.mode === "account" ? cashSide(l.source.paymentMethod ?? "bank_transfer", l.source.account, l.date) ?? "opening_equity" : "opening_equity";
    post(l.date, source, [[into, l.originalAmount, into.startsWith("cash:") ? cf("financing", "Loans and borrowings received") : undefined], [`liab:${l.group}`, -l.originalAmount]]);
    for (const [i, p] of (l.payments ?? []).entries()) {
      if (!p.principal || p.date.getTime() > asOf.getTime()) continue;
      const cash = cashSide(p.paymentMethod ?? "bank_transfer", p.account, p.date) ?? "opening_equity";
      post(p.date, { kind: "liability_payment", id: `${id}:${i}`, label: `Repayment, ${l.code} ${l.name}`, href: source.href }, [
        [`liab:${l.group}`, p.principal],
        [cash, -p.principal, cash.startsWith("cash:") ? cf("financing", "Loans and borrowings repaid") : undefined],
      ]);
    }
  }

  // Capital, drawings, dividends, reserves.
  for (const c of entries) {
    const id = String(c._id);
    const source: PostingSource = { kind: "capital", id, label: `${c.number} ${CAPITAL_LABEL[c.type] ?? c.type}`, href: `/finance/equity?view=${id}` };
    const holder = c.holder ? holderKind.get(String(c.holder)) : undefined;
    const cashOf = () => cashSide(c.paymentMethod ?? "bank_transfer", c.account, c.date) ?? "opening_equity";
    switch (c.type) {
      case "capital": {
        const cash = cashOf();
        post(c.date, source, [[cash, c.amount, cash.startsWith("cash:") ? cf("financing", "Capital introduced") : undefined], [holder === "investor" ? "capital:investors" : "capital:owners", -c.amount]]);
        break;
      }
      case "drawing": {
        const cash = cashOf();
        post(c.date, source, [["drawings", c.amount], [cash, -c.amount, cash.startsWith("cash:") ? cf("financing", "Drawings by owners") : undefined]]);
        break;
      }
      case "dividend": {
        const cash = cashOf();
        post(c.date, source, [["retained", c.amount], [cash, -c.amount, cash.startsWith("cash:") ? cf("financing", "Dividends paid") : undefined]]);
        break;
      }
      case "reserve_transfer":
        post(c.date, source, [["retained", c.amount], [`reserve:${c.reserveGroup || "general_reserve"}`, -c.amount]]);
        break;
      case "opening_retained":
        post(c.date, source, [["opening_equity", c.amount], ["retained", -c.amount]]);
        break;
    }
  }

  // Transfers between own accounts.
  for (const t of transfers) {
    const from = cashSide("bank_transfer", t.from, t.date) ?? "opening_equity";
    const to = cashSide("bank_transfer", t.to, t.date) ?? "opening_equity";
    post(t.date, { kind: "transfer", id: String(t._id), label: "Transfer between own accounts" }, [
      [to, t.amount, cf("internal", "Transfer")],
      [from, -t.amount, cf("internal", "Transfer")],
    ]);
  }

  postings.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { asOf, postings, accounts, book };
}

/** The ledger up to a day, once per request. */
export const getLedger = cache(async (asOfKey: string | null) => buildLedger(asOfKey ? new Date(asOfKey) : null));

/** Convenience: the ledger as of a date (end of that IST day, never after today). */
export function ledgerAsOf(asOf?: Date | null): Promise<Ledger> {
  return getLedger(asOf ? effectiveAsOf(asOf).toISOString() : null);
}

const CAPITAL_LABEL: Record<string, string> = {
  capital: "Capital introduced",
  drawing: "Drawing",
  dividend: "Dividend",
  reserve_transfer: "Transfer to reserve",
  opening_retained: "Opening retained earnings",
};

function movementLabel(type: string): string {
  switch (type) {
    case "purchase":
      return "Opening stock on hand";
    case "assign":
      return "Stock used on a project";
    case "return":
      return "Stock returned from a project";
    case "adjustment":
      return "Stock adjustment";
    case "wastage":
      return "Stock written off";
    default:
      return "Stock movement";
  }
}

/** Accounts with a fixed meaning. */
const FIXED_ACCOUNTS: Record<string, LedgerAccountMeta> = {
  inventory: { code: "inventory", name: "Inventory", type: "asset", group: "inventory" },
  receivables: { code: "receivables", name: "Accounts receivable", type: "asset", group: "receivables" },
  prepaid: { code: "prepaid", name: "Prepaid expenses", type: "asset", group: "prepaid" },
  gst_input: { code: "gst_input", name: "GST input credit", type: "asset", group: "gst_receivable" },
  gst_output: { code: "gst_output", name: "GST on invoices", type: "liability", group: "taxes_payable" },
  ap: { code: "ap", name: "Accounts payable", type: "liability", group: "accounts_payable" },
  group_company: { code: "group_company", name: "Due to Biios Startup LLP", type: "liability", group: "group_company_payable" },
  customer_advances: { code: "customer_advances", name: "Customer advances", type: "liability", group: "customer_advances" },
  "capital:owners": { code: "capital:owners", name: "Owner's capital", type: "equity", group: "owners_capital" },
  "capital:investors": { code: "capital:investors", name: "Investors' capital", type: "equity", group: "investors_capital" },
  drawings: { code: "drawings", name: "Drawings", type: "equity", group: "drawings" },
  retained: { code: "retained", name: "Retained earnings", type: "equity", group: "retained_earnings" },
  opening_equity: { code: "opening_equity", name: "Opening balance equity", type: "equity", group: "opening_balance" },
  materials_consumed: { code: "materials_consumed", name: "Stock used on projects", type: "expense", pl: "materials" },
  purchase_difference: { code: "purchase_difference", name: "Purchase charges and differences", type: "expense", pl: "materials" },
  stock_adjustments: { code: "stock_adjustments", name: "Stock count adjustments", type: "expense", pl: "other_expense" },
  stock_written_off: { code: "stock_written_off", name: "Stock written off (wastage)", type: "expense", pl: "other_expense" },
  loss_on_disposal: { code: "loss_on_disposal", name: "Loss on sale of assets", type: "expense", pl: "other_expense" },
  gain_on_disposal: { code: "gain_on_disposal", name: "Gain on sale of assets", type: "income", pl: "other_income" },
  investment_gain: { code: "investment_gain", name: "Gain on investments", type: "income", pl: "other_income" },
  investment_loss: { code: "investment_loss", name: "Loss on investments", type: "expense", pl: "other_expense" },
  rounding: { code: "rounding", name: "Rounding", type: "expense", pl: "indirect" },
};

/** The last moment of a month ("2026-10"), or `cap` when that is earlier. */
function monthEnd(month: string, cap: Date): Date {
  const [y, m] = month.split("-").map(Number);
  const end = endOfDayIST(new Date(Date.UTC(y, m, 0, 12)));
  return end.getTime() > cap.getTime() ? cap : end;
}

/** A prepaid amount spread evenly by day over [from, to], one piece per month, up to `asOf`. */
function spread(amount: number, from: Date, to: Date, asOf: Date): { date: Date; amount: number }[] {
  const DAY = 86_400_000;
  const start = startOfDayIST(from);
  const end = startOfDayIST(to);
  if (end.getTime() < start.getTime()) return [];
  const days = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  const out: { date: Date; amount: number }[] = [];
  let used = 0;
  let cursor = start;
  while (cursor.getTime() <= end.getTime() && cursor.getTime() <= asOf.getTime()) {
    const nextMonth = startOfMonthIST(cursor, 1);
    const stop = new Date(Math.min(nextMonth.getTime() - DAY, end.getTime()));
    const capped = stop.getTime() > asOf.getTime() ? startOfDayIST(asOf) : stop;
    const n = Math.round((capped.getTime() - cursor.getTime()) / DAY) + 1;
    const value = capped.getTime() === end.getTime() ? round2(amount - used) : round2((amount * n) / days);
    used = round2(used + value);
    const at = endOfDayIST(capped);
    out.push({ date: at.getTime() > asOf.getTime() ? asOf : at, amount: value });
    if (capped.getTime() < stop.getTime()) break;
    cursor = nextMonth;
  }
  return out;
}

/** Keeps the group helpers in one import for statement code. */
export { builtInAncestors };
