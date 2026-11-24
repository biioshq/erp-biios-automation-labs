import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, FixedAsset, InventoryAllocation, InventoryItem, InventoryMovement, Project, ProjectMember, Task } from "@/server/models";
import { DEFAULT_WINDOW_DAYS, lookAheadAlerts, type StockAlert } from "@/server/analytics/core";
import { DEPARTMENTS, labelOf, type AssetCondition, type ProjectStatus } from "@/lib/constants";
import { addDays, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { loadMovements, round3 } from "@/features/analytics/inventory/data";

/**
 * Resource utilisation (5.3), from what the ERP records:
 *  - Materials: stock assignments (InventoryAllocation). Assigned, returned, wasted on site, and
 *    still in use = (quantity - quantityWasted) x the cost it was assigned at. Installation is not
 *    recorded separately, so stock in use counts as used by the project.
 *  - A move to another project is recorded on the allocation as a return. The ledger marks the
 *    return half of a move with `allocation` (plain returns have none), so moved stock is split
 *    out of returned: "returned" here is stock that went back to storage.
 *  - Equipment: fixed assets placed with the project. Hours of use are not recorded.
 *  - Manpower: open project memberships with their allocation share. Time spent is not recorded
 *    (no timesheets); open tasks show the work load instead.
 *  - Shortages: materials at risk (the inventory alerts) that the project used recently.
 * Salaries are never read here.
 */

/** assigned = returned + movedOut + wasted + inUse. movedIn: the part of assigned that came from another project. */
export type MaterialUse = { assigned: number; returned: number; movedOut: number; movedIn: number; wasted: number; inUse: number; items: number };

export type MaterialLine = {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  assignedQty: number;
  /** Back to storage. */
  returnedQty: number;
  /** Moved to another project. */
  movedQty: number;
  wastedQty: number;
  inUseQty: number;
  assignedValue: number;
  returnedValue: number;
  movedValue: number;
  wastedValue: number;
  inUseValue: number;
  lastAssigned: string | null;
};

export type EquipmentLine = { id: string; code: string; name: string; isEquipment: boolean; until: string | null; condition: AssetCondition };

export type MemberLine = {
  employeeId: string;
  name: string;
  designation: string | null;
  department: string;
  status: string;
  role: string;
  allocation: number;
  /** The person's allocation over every open project. */
  totalAllocation: number;
  openTasks: number;
};

export type ProjectResources = {
  id: string;
  code: string;
  name: string;
  color: string;
  status: ProjectStatus;
  materials: MaterialUse;
  materialLines: MaterialLine[];
  equipment: EquipmentLine[];
  members: MemberLine[];
  fte: number;
  openTasks: number;
  unassignedOpenTasks: number;
  shortages: { id: string; name: string; sku: string; level: StockAlert["level"]; reasons: string[] }[];
};

export type PersonLoad = {
  employeeId: string;
  name: string;
  designation: string | null;
  department: string;
  totalAllocation: number;
  projects: { id: string; name: string; allocation: number }[];
  openTasks: number;
};

export type ResourcesData = {
  projects: ProjectResources[];
  people: PersonLoad[];
  total: number;
  /** Allocated to the projects shown, less what came from another project: each unit counted once. */
  issuedFromStorage: number;
};

/** Value of stock each project received from another project (the assignment halves of moves), all time. */
async function movedInByProject(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  // Both halves of a move carry the same allocation; plain returns carry none.
  const moveAllocations = await InventoryMovement.distinct("allocation", { type: "return", allocation: { $ne: null } });
  if (!moveAllocations.length) return new Map();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; value: number }>([
    { $match: { type: "assign", project: { $in: ids }, allocation: { $in: moveAllocations } } },
    { $group: { _id: "$project", value: { $sum: { $ifNull: ["$totalCost", 0] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), round2(r.value)]));
}

const OPEN_TASK = { status: { $nin: ["completed", "cancelled"] } };

export async function getResources(statuses: ProjectStatus[] | null, now: Date = new Date()): Promise<ResourcesData> {
  await connectDB();
  const [projects, total] = await Promise.all([
    Project.find(statuses ? { status: { $in: statuses } } : {}, { code: 1, name: 1, color: 1, status: 1 }).sort({ createdAt: -1 }).lean(),
    Project.countDocuments({}),
  ]);
  const ids = projects.map((p) => p._id);
  const windowStart = startOfDayIST(addDays(now, -DEFAULT_WINDOW_DAYS + 1));
  const [allocations, assets, members, tasks, alerts, recent, moves, movedIn] = await Promise.all([
    InventoryAllocation.find({ project: { $in: ids } }, { project: 1, item: 1, quantity: 1, quantityAssigned: 1, quantityReturned: 1, quantityWasted: 1, unitCost: 1, assignedAt: 1 }).lean(),
    FixedAsset.find(
      { project: { $in: ids }, archivedAt: null, "disposal.date": { $exists: false } },
      { code: 1, name: 1, isEquipment: 1, project: 1, projectUntil: 1, condition: 1 },
    ).lean(),
    // Every open membership, all projects: a person's total allocation spans projects outside the filter too.
    ProjectMember.find({ endDate: null }, { project: 1, employee: 1, role: 1, allocation: 1 }).lean(),
    Task.aggregate<{ _id: { project: Types.ObjectId; assignee: Types.ObjectId | null }; n: number }>([
      { $match: { project: { $in: ids }, ...OPEN_TASK } },
      { $group: { _id: { project: "$project", assignee: "$assignee" }, n: { $sum: 1 } } },
    ]),
    lookAheadAlerts(now),
    loadMovements(windowStart, now),
    // Return halves of moves to another project, all time, per project and item.
    InventoryMovement.aggregate<{ _id: { project: Types.ObjectId; item: Types.ObjectId }; qty: number; value: number }>([
      { $match: { type: "return", project: { $in: ids }, allocation: { $ne: null } } },
      { $group: { _id: { project: "$project", item: "$item" }, qty: { $sum: "$quantity" }, value: { $sum: { $ifNull: ["$totalCost", 0] } } } },
    ]),
    movedInByProject(ids),
  ]);
  const movedBy = new Map(moves.map((m) => [`${String(m._id.project)}:${String(m._id.item)}`, { qty: m.qty, value: m.value }]));

  const itemIds = [...new Set(allocations.map((a) => String(a.item)))].map((id) => new Types.ObjectId(id));
  const employeeIds = [...new Set(members.map((m) => String(m.employee)))].map((id) => new Types.ObjectId(id));
  const [items, employees, allProjects] = await Promise.all([
    InventoryItem.find({ _id: { $in: itemIds } }, { name: 1, sku: 1, unit: 1 }).lean(),
    Employee.find({ _id: { $in: employeeIds } }, { name: 1, designation: 1, department: 1, status: 1, user: 1 }).lean(),
    Project.find({ status: { $nin: ["completed", "cancelled"] } }, { name: 1 }).lean(),
  ]);
  const itemBy = new Map(items.map((i) => [String(i._id), i]));
  const employeeBy = new Map(employees.map((e) => [String(e._id), e]));
  const openProjectName = new Map(allProjects.map((p) => [String(p._id), p.name]));

  // A membership on a closed project no longer takes the person's time.
  const openMembers = members.filter((m) => openProjectName.has(String(m.project)));
  const totalAllocation = new Map<string, number>();
  for (const m of openMembers) totalAllocation.set(String(m.employee), (totalAllocation.get(String(m.employee)) ?? 0) + (m.allocation ?? 0));

  const tasksBy = new Map<string, number>();
  const unassignedBy = new Map<string, number>();
  const tasksByUser = new Map<string, number>();
  for (const t of tasks) {
    const pid = String(t._id.project);
    tasksBy.set(pid, (tasksBy.get(pid) ?? 0) + t.n);
    if (!t._id.assignee) unassignedBy.set(pid, (unassignedBy.get(pid) ?? 0) + t.n);
    else tasksByUser.set(`${pid}:${String(t._id.assignee)}`, t.n);
  }

  const alertBy = new Map(alerts.map((a) => [a.id, a]));
  const usedRecently = new Map<string, Set<string>>();
  for (const m of recent) {
    if (m.type !== "assign" || !m.project) continue;
    const set = usedRecently.get(m.project) ?? new Set<string>();
    set.add(m.item);
    usedRecently.set(m.project, set);
  }

  const result: ProjectResources[] = projects.map((p) => {
    const pid = String(p._id);
    const lines = new Map<string, MaterialLine>();
    for (const a of allocations.filter((x) => String(x.project) === pid)) {
      const iid = String(a.item);
      const it = itemBy.get(iid);
      const line = lines.get(iid) ?? {
        itemId: iid,
        name: it?.name ?? "Deleted item",
        sku: it?.sku ?? "",
        unit: it?.unit ?? "pcs",
        assignedQty: 0,
        returnedQty: 0,
        movedQty: 0,
        wastedQty: 0,
        inUseQty: 0,
        assignedValue: 0,
        returnedValue: 0,
        movedValue: 0,
        wastedValue: 0,
        inUseValue: 0,
        lastAssigned: null,
      };
      const wasted = a.quantityWasted ?? 0;
      const inUse = Math.max(0, a.quantity - wasted);
      line.assignedQty = round3(line.assignedQty + a.quantityAssigned);
      line.returnedQty = round3(line.returnedQty + (a.quantityReturned ?? 0));
      line.wastedQty = round3(line.wastedQty + wasted);
      line.inUseQty = round3(line.inUseQty + inUse);
      line.assignedValue = round2(line.assignedValue + a.quantityAssigned * a.unitCost);
      line.returnedValue = round2(line.returnedValue + (a.quantityReturned ?? 0) * a.unitCost);
      line.wastedValue = round2(line.wastedValue + wasted * a.unitCost);
      line.inUseValue = round2(line.inUseValue + inUse * a.unitCost);
      const day = toDateInput(a.assignedAt);
      line.lastAssigned = !line.lastAssigned || day > line.lastAssigned ? day : line.lastAssigned;
      lines.set(iid, line);
    }
    // Split moves out of the returns: what is left went back to storage. The moved value is what the
    // move credited, so a paisa of rounding between the two stays inside the returned figure.
    for (const line of lines.values()) {
      const moved = movedBy.get(`${pid}:${line.itemId}`);
      if (!moved) continue;
      line.movedQty = round3(Math.min(moved.qty, line.returnedQty));
      line.movedValue = round2(Math.min(moved.value, line.returnedValue));
      line.returnedQty = round3(line.returnedQty - line.movedQty);
      line.returnedValue = round2(line.returnedValue - line.movedValue);
    }
    const materialLines = [...lines.values()].sort((x, y) => y.inUseValue - x.inUseValue);
    const sum = (pick: (l: MaterialLine) => number) => round2(materialLines.reduce((s, l) => s + pick(l), 0));

    const projectMembers: MemberLine[] = openMembers
      .filter((m) => String(m.project) === pid)
      .map((m) => {
        const e = employeeBy.get(String(m.employee));
        return {
          employeeId: String(m.employee),
          name: e?.name ?? "Removed employee",
          designation: e?.designation ?? null,
          department: e?.department ? labelOf(DEPARTMENTS, e.department) : "Not set",
          status: e?.status ?? "active",
          role: m.role ?? "Team member",
          allocation: m.allocation ?? 0,
          totalAllocation: totalAllocation.get(String(m.employee)) ?? 0,
          openTasks: e?.user ? (tasksByUser.get(`${pid}:${String(e.user)}`) ?? 0) : 0,
        };
      })
      .sort((x, y) => y.allocation - x.allocation);

    return {
      id: pid,
      code: p.code,
      name: p.name,
      color: p.color ?? "#4a82cc",
      status: p.status,
      materials: {
        assigned: sum((l) => l.assignedValue),
        returned: sum((l) => l.returnedValue),
        movedOut: sum((l) => l.movedValue),
        movedIn: movedIn.get(pid) ?? 0,
        wasted: sum((l) => l.wastedValue),
        inUse: sum((l) => l.inUseValue),
        items: materialLines.length,
      },
      materialLines,
      equipment: assets
        .filter((a) => String(a.project) === pid)
        .map((a) => ({
          id: String(a._id),
          code: a.code,
          name: a.name,
          isEquipment: Boolean(a.isEquipment),
          until: a.projectUntil ? toDateInput(a.projectUntil) : null,
          condition: (a.condition ?? "good") as AssetCondition,
        })),
      members: projectMembers,
      fte: Math.round(projectMembers.reduce((s, m) => s + m.allocation, 0)) / 100,
      openTasks: tasksBy.get(pid) ?? 0,
      unassignedOpenTasks: unassignedBy.get(pid) ?? 0,
      shortages: [...(usedRecently.get(pid) ?? [])]
        .map((iid) => alertBy.get(iid))
        .filter((a): a is StockAlert => Boolean(a))
        .map((a) => ({ id: a.id, name: a.name, sku: a.sku, level: a.level, reasons: a.reasons })),
    };
  });

  // People on open projects with their load across all of them, most loaded first.
  const people = new Map<string, PersonLoad>();
  for (const m of openMembers) {
    const eid = String(m.employee);
    const e = employeeBy.get(eid);
    const row = people.get(eid) ?? {
      employeeId: eid,
      name: e?.name ?? "Removed employee",
      designation: e?.designation ?? null,
      department: e?.department ? labelOf(DEPARTMENTS, e.department) : "Not set",
      totalAllocation: totalAllocation.get(eid) ?? 0,
      projects: [],
      openTasks: 0,
    };
    row.projects.push({ id: String(m.project), name: openProjectName.get(String(m.project)) ?? "Project", allocation: m.allocation ?? 0 });
    if (e?.user) row.openTasks += tasksByUser.get(`${String(m.project)}:${String(e.user)}`) ?? 0;
    people.set(eid, row);
  }

  const assigned = result.reduce((s, r) => s + r.materials.assigned, 0);
  const cameFromProjects = result.reduce((s, r) => s + r.materials.movedIn, 0);
  return {
    projects: result,
    people: [...people.values()].sort((a, b) => b.totalAllocation - a.totalAllocation),
    total,
    issuedFromStorage: round2(Math.max(0, assigned - cameFromProjects)),
  };
}
