"use server";

import { connectDB } from "@/server/db";
import { Expense, Income, InventoryItem, Project, Task } from "@/server/models";
import { getCurrentUser, salaryScope } from "@/server/auth/session";
import { searchRegex } from "@/lib/list-params";
import { formatCurrency, formatDate } from "@/lib/format";

export type SearchHit = { id: string; title: string; subtitle: string; href: string };
export type SearchGroups = { projects: SearchHit[]; expenses: SearchHit[]; income: SearchHit[]; inventory: SearchHit[]; tasks: SearchHit[] };

/** Command palette search across modules. Five hits per module. */
export async function globalSearch(query: string): Promise<SearchGroups> {
  const empty: SearchGroups = { projects: [], expenses: [], income: [], inventory: [], tasks: [] };
  const q = query.trim().slice(0, 80);
  if (q.length < 2 || !(await getCurrentUser())) return empty;
  await connectDB();
  const re = searchRegex(q);

  const [projects, expenses, income, items, tasks] = await Promise.all([
    Project.find({ $or: [{ name: re }, { code: re }, { client: re }] }).limit(5).lean(),
    Expense.find({ ...(await salaryScope()), $or: [{ vendor: re }, { number: re }, { description: re }, { "gst.invoiceNumber": re }] })
      .sort({ date: -1 })
      .limit(5)
      .lean(),
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
    expenses: expenses.map((e) => ({
      id: String(e._id),
      title: e.vendor,
      subtitle: `${e.number} · ${formatCurrency(e.amount)} · ${formatDate(e.date)}`,
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
