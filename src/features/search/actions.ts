"use server";

import { connectDB } from "@/server/db";
import { Expense, Income, InventoryItem, Project, Task } from "@/server/models";
import { getCurrentUser, salaryScope } from "@/server/auth/session";
import { searchRegex } from "@/lib/list-params";
import { formatCurrency, formatDate } from "@/lib/format";
import { getExpenseCategories } from "@/server/expense-categories";
import { expenseCategoryLabel, type ExpenseCategoryOption } from "@/lib/expense-categories";

export type SearchHit = { id: string; title: string; subtitle: string; href: string };
export type SearchGroups = { projects: SearchHit[]; expenses: SearchHit[]; income: SearchHit[]; inventory: SearchHit[]; tasks: SearchHit[] };

/** Command palette search across modules. Five hits per module. */
export async function globalSearch(query: string): Promise<SearchGroups> {
  const empty: SearchGroups = { projects: [], expenses: [], income: [], inventory: [], tasks: [] };
  const q = query.trim().slice(0, 80);
  if (q.length < 2 || !(await getCurrentUser())) return empty;
  await connectDB();
  const re = searchRegex(q);
  const categories = await getExpenseCategories();

  const [projects, expenses, income, items, tasks] = await Promise.all([
    Project.find({ $or: [{ name: re }, { code: re }, { client: re }] }).limit(5).lean(),
    searchExpenses(re, categories),
    Income.find({ $or: [{ client: re }, { number: re }, { reference: re }] }).sort({ date: -1 }).limit(5).lean(),
    InventoryItem.find({ archivedAt: null, $or: [{ name: re }, { sku: re }, { vendor: re }] }).limit(5).lean(),
    Task.find({ $or: [{ title: re }, { number: re }] }).sort({ updatedAt: -1 }).limit(5).lean(),
  ]);

  return {
    projects: projects.map((p) => ({
      id: String(p._id),
      title: p.name,
      subtitle: [p.code, p.client].filter(Boolean).join(" · "),
      href: `/finance/projects/${p._id}`,
    })),
    expenses: expenses.map(({ byCategory, ...e }) => ({
      id: String(e._id),
      title: e.vendor,
      // A hit found only by its category says so, so people can see why it matched.
      subtitle: [e.number, byCategory ? expenseCategoryLabel(categories, e.category) : "", formatCurrency(e.amount), formatDate(e.date)]
        .filter(Boolean)
        .join(" · "),
      href: `/finance/expenses?view=${e._id}`,
    })),
    income: income.map((i) => ({
      id: String(i._id),
      title: i.client,
      subtitle: `${i.number} · ${formatCurrency(i.amount)} · ${formatDate(i.date)}`,
      href: `/finance/income?view=${i._id}`,
    })),
    inventory: items.map((i) => ({
      id: String(i._id),
      title: i.name,
      subtitle: `${i.sku} · ${i.available} ${i.unit} available`,
      href: `/inventory/items/${i._id}`,
    })),
    tasks: tasks.map((t) => ({
      id: String(t._id),
      title: t.title,
      subtitle: `${t.number} · ${t.status.replace("_", " ")}`,
      href: `/tasks/all?task=${t._id}`,
    })),
  };
}

/**
 * Expenses whose vendor, number, description or invoice number match, as before. Only when those
 * leave room does it add expenses in a category whose name matches ("fuel" finds the Fuel
 * category, custom or renamed ones included), so category matches never push text matches out.
 */
async function searchExpenses(re: RegExp, categories: readonly ExpenseCategoryOption[]) {
  const scope = await salaryScope();
  const text = await Expense.find({ ...scope, $or: [{ vendor: re }, { number: re }, { description: re }, { "gst.invoiceNumber": re }] })
    .sort({ date: -1 })
    .limit(5)
    .lean();
  const hits = text.map((e) => ({ ...e, byCategory: false }));
  const categoryValues = categories.filter((c) => re.test(c.label)).map((c) => c.value);
  if (hits.length >= 5 || !categoryValues.length) return hits;
  // $and keeps the salary scope's own category condition instead of overwriting it.
  const more = await Expense.find({ $and: [scope, { category: { $in: categoryValues } }, { _id: { $nin: text.map((e) => e._id) } }] })
    .sort({ date: -1 })
    .limit(5 - hits.length)
    .lean();
  return [...hits, ...more.map((e) => ({ ...e, byCategory: true }))];
}
