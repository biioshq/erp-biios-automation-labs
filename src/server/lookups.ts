import "server-only";

import { connectDB } from "@/server/db";
import { Expense, InventoryCategory, InventoryItem, InventoryMovement, Project } from "@/server/models";
import { salaryScope } from "@/server/auth/session";
import { getStockStatus } from "@/lib/stock-status";
import type { ProjectStatus, StockStatus } from "@/lib/constants";
import { roundQty } from "@/server/services/inventory-ledger";
import { variantHint } from "@/features/inventory/items/attributes";

/** Option lists for pickers and filters, shared by every module. */

export type ProjectOption = { value: string; label: string; description: string; status: ProjectStatus; color: string };

export async function getProjectOptions(): Promise<ProjectOption[]> {
  await connectDB();
  const projects = await Project.find({}, { name: 1, code: 1, client: 1, status: 1, color: 1 }).sort({ name: 1 }).lean();
  return projects.map((p) => ({
    value: String(p._id),
    label: p.name,
    description: [p.code, p.client].filter(Boolean).join(" · "),
    status: p.status as ProjectStatus,
    color: p.color ?? "#4a82cc",
  }));
}

/** Known vendor names (expenses, recurring bills, stock purchases and items), most used first. */
export async function getVendorNames(limit = 300): Promise<string[]> {
  await connectDB();
  // Salary payees are employees: members never see who is paid (salaryScope is empty for admins).
  // Assignment expenses only repeat an item's vendor (or "Company stock"), so they are left out.
  const scope = await salaryScope();
  const [fromExpenses, fromPurchases, fromItems] = await Promise.all([
    Expense.aggregate<{ _id: string }>([
      { $match: { source: { $ne: "inventory_assignment" }, ...scope } },
      { $group: { _id: "$vendor", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: limit },
    ]),
    // Older suppliers of an item stay findable after another vendor becomes its latest one.
    InventoryMovement.distinct("vendor", { type: "purchase" }),
    InventoryItem.distinct("vendor"),
  ]);
  return [...new Set([...fromExpenses.map((v) => v._id), ...(fromPurchases as string[]), ...(fromItems as string[])].filter(Boolean))];
}

export type ItemOption = {
  value: string;
  label: string;
  description: string;
  sku: string;
  unit: string;
  available: number;
  allocated: number;
  minStock: number;
  unitPrice: number;
  status: StockStatus;
};

export async function getInventoryItemOptions(): Promise<ItemOption[]> {
  await connectDB();
  const items = await InventoryItem.find({ archivedAt: null }).sort({ name: 1 }).lean();
  return items.map((i) => {
    // Older writes can leave float drift (5.55e-17): show and judge stock to 3 decimals, as the ledger does.
    const available = roundQty(i.available);
    return {
      value: String(i._id),
      label: i.name,
      // The value or rating tells same-named parts apart (a 110 ohm and a 180K ohm resistor).
      description: [i.sku, variantHint({ attributes: i.attributes, subcategory: null }, 30), `${available} ${i.unit} available`].filter(Boolean).join(" · "),
      sku: i.sku,
      unit: i.unit ?? "pcs",
      available,
      allocated: roundQty(i.allocated),
      minStock: i.minStock,
      unitPrice: i.unitPrice,
      status: getStockStatus(available, i.minStock),
    };
  });
}

export async function getInventoryCategoryOptions(): Promise<{ value: string; label: string; color: string }[]> {
  await connectDB();
  const cats = await InventoryCategory.find().sort({ name: 1 }).lean();
  return cats.map((c) => ({ value: String(c._id), label: c.name, color: c.color ?? "#4a82cc" }));
}

export type EmployeeOption = { value: string; label: string; description: string; department: string; status: string };

/** People for pickers (project team, salary schedules). Exited employees come last. */
export async function getEmployeeOptions(): Promise<EmployeeOption[]> {
  await connectDB();
  const { Employee } = await import("@/server/models");
  const people = await Employee.find({}, { name: 1, code: 1, designation: 1, department: 1, status: 1 }).sort({ status: 1, name: 1 }).lean();
  return people.map((p) => ({
    value: String(p._id),
    label: p.name,
    description: [p.code, p.designation].filter(Boolean).join(" · "),
    department: p.department ?? "",
    status: p.status ?? "active",
  }));
}
