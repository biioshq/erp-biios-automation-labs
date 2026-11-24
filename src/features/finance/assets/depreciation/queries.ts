import "server-only";

import { connectDB } from "@/server/db";
import { FixedAsset } from "@/server/models";
import { iso } from "@/server/serialize";
import { loadFinanceGroups } from "@/server/finance-groups";
import type { GroupOption } from "@/features/finance/groups/types";
import { labelsFor, type AssetKind } from "@/features/finance/assets/fixed/labels";
import { bookValue, depreciationBetween } from "@/lib/depreciation";
import { endOfDayIST, fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { DepreciationMethod } from "@/lib/constants";
import { currentFyStart, type AssetKindFilter } from "./period";
import type { DepreciationAssetRow, DepreciationFigures, DepreciationGroupRow, DepreciationSummary } from "./types";

const zero = (): DepreciationFigures => ({ cost: 0, charged: 0, accumulated: 0, bookValue: 0, count: 0 });

function add(t: DepreciationFigures, o: DepreciationFigures) {
  t.cost = round2(t.cost + o.cost);
  t.charged = round2(t.charged + o.charged);
  t.accumulated = round2(t.accumulated + o.accumulated);
  t.bookValue = round2(t.bookValue + o.bookValue);
  t.count += o.count;
}

const fyOf = (d: Date) => currentFyStart(d);

/**
 * Per group and per asset: original value, what was charged within the period
 * (depreciationBetween), accumulated depreciation and book value at the period's end. Figures come
 * from src/lib/depreciation.ts, the functions the balance sheet uses, so they agree with it.
 */
export async function depreciationSummary(fromInput: string, toInput: string, kind: AssetKindFilter): Promise<DepreciationSummary> {
  await connectDB();
  const from = fromDateInput(fromInput);
  const to = endOfDayIST(fromDateInput(toInput));
  const kindFilter: Record<string, unknown> = kind === "intangible" ? { kind: "intangible" } : kind === "tangible" ? { kind: { $ne: "intangible" } } : {};
  const [groups, docs, earliest] = await Promise.all([
    loadFinanceGroups("asset", { includeArchived: true }),
    // Archived assets are disposed ones; they still count for the months they were held.
    FixedAsset.find({ ...kindFilter, purchaseDate: { $lte: to } }).sort({ code: 1 }).lean(),
    FixedAsset.findOne(kindFilter, { purchaseDate: 1 }).sort({ purchaseDate: 1 }).lean(),
  ]);
  const groupByKey = new Map(groups.map((g) => [g.key, g]));

  const assets: DepreciationAssetRow[] = [];
  for (const a of docs) {
    const disposedOn = a.disposal?.date && a.disposal.date.getTime() <= to.getTime() ? a.disposal.date : null;
    const charged = depreciationBetween(a, from, to);
    if (disposedOn && charged <= 0) continue;
    const v = disposedOn ? { cost: 0, accumulated: 0, bookValue: 0 } : bookValue(a, to);
    assets.push({
      id: String(a._id),
      code: a.code,
      name: a.name,
      kind: a.kind === "intangible" ? "intangible" : "tangible",
      groupPath: groupByKey.get(a.group)?.path ?? a.group,
      purchaseDate: iso(a.purchaseDate)!,
      method: (a.depreciationMethod ?? "slm") as DepreciationMethod,
      usefulLifeYears: a.usefulLifeYears ?? 0,
      wdvRate: a.wdvRate ?? null,
      disposedOn: iso(disposedOn),
      cost: v.cost,
      charged,
      accumulated: v.accumulated,
      bookValue: v.bookValue,
      count: disposedOn ? 0 : 1,
    });
  }

  const own = new Map<string, DepreciationFigures>();
  const docGroup = new Map(docs.map((d) => [String(d._id), d.group]));
  for (const r of assets) {
    const key = docGroup.get(r.id)!;
    const t = own.get(key) ?? zero();
    add(t, r);
    own.set(key, t);
  }

  const rows: DepreciationGroupRow[] = [];
  const kinds: AssetKind[] = kind === "all" ? ["tangible", "intangible"] : [kind];
  const placed = new Set<string>();
  const walk = (g: GroupOption, depth: number, k: AssetKind, withChildren = true): DepreciationFigures => {
    const index = rows.length;
    rows.push({ key: g.key, label: g.label, depth, kind: k, ...zero() });
    placed.add(g.key);
    const total = zero();
    add(total, own.get(g.key) ?? zero());
    if (withChildren) for (const c of groups.filter((x) => x.parent === g.key)) add(total, walk(c, depth + 1, k));
    Object.assign(rows[index], total);
    return total;
  };
  for (const k of kinds) {
    const { root, roots } = labelsFor(k);
    const main = groupByKey.get(root);
    if (main && own.has(root)) {
      const t = own.get(root)!;
      rows.push({ key: root, label: `${main.label}, no category`, depth: 0, kind: k, ...t });
      placed.add(root);
    }
    for (const c of groups.filter((g) => g.parent === root)) walk(c, 0, k);
    for (const key of roots.filter((r) => r !== root)) {
      const g = groupByKey.get(key);
      if (g) walk(g, 0, k);
    }
  }
  // Assets under a group that no longer exists still count.
  const lost = zero();
  for (const [key, t] of own) if (!placed.has(key)) add(lost, t);
  if (lost.count || lost.charged) rows.push({ key: "_unknown", label: "Other groups", depth: 0, kind: "tangible", ...lost });

  const totals = zero();
  const byKind: Record<AssetKind, DepreciationFigures> = { tangible: zero(), intangible: zero() };
  for (const r of assets) {
    add(totals, r);
    add(byKind[r.kind], r);
  }
  const startYear = earliest ? fyOf(earliest.purchaseDate) : currentFyStart();
  const years: number[] = [];
  for (let y = currentFyStart(); y >= startYear; y--) years.push(y);

  return {
    from: fromInput,
    to: toInput,
    groups: rows.filter((r) => r.count > 0 || r.charged > 0),
    assets,
    totals,
    byKind,
    years,
  };
}
