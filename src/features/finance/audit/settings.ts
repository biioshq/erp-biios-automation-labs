import "server-only";

import type { Types } from "mongoose";
import { auditSafely, diffSnapshots, hideEarlierAsSalary, snapshotChanges, type AuditEntry } from "@/server/audit";
import type { ExpenseCategoryOption } from "@/lib/expense-categories";

/**
 * Audit entries for settings that reclassify many records at once: expense categories (a rename
 * or a direct / indirect change applies to every past expense of the category) and the bank
 * statement's remembered parties (they shape the suggestions for every later statement).
 */

const NATURE = { direct: "Direct", indirect: "Indirect" } as Record<string, string>;

const categorySnapshot = (c: ExpenseCategoryOption) => ({ label: c.label, hidden: c.hidden, nature: NATURE[c.nature] ?? c.nature });

/** One entry for an added, changed or deleted category. Nothing is written when nothing changed. */
export async function auditCategoryChange(before: ExpenseCategoryOption | null, after: ExpenseCategoryOption | null): Promise<void> {
  await auditSafely((): AuditEntry | null => {
    const c = after ?? before;
    if (!c) return null;
    const entity = { type: "expense_category" as const, id: c.value, label: c.label };
    if (!before) return { action: "created", entity, changes: snapshotChanges(categorySnapshot(c), "to") };
    if (!after) return { action: "deleted", entity, changes: snapshotChanges({ label: before.label }, "from") };
    const changes = diffSnapshots(categorySnapshot(before), categorySnapshot(after));
    if (!changes.length) return null;
    const retro = changes.some((x) => x.field === "label" || x.field === "nature");
    return {
      action: "rule_changed",
      entity,
      changes,
      note: retro ? "Applies to every expense of this category, past ones included" : null,
    };
  });
}

type RuleLike = {
  _id: Types.ObjectId | string;
  side: string;
  key: string;
  party?: string | null;
  category?: string | null;
  project?: unknown;
  stage?: string | null;
};

const ruleLabel = (r: RuleLike) => `${r.side === "in" ? "Payer" : "Payee"} ${r.key}`;

const ruleSnapshot = (r: RuleLike) => ({
  party: r.party,
  [r.side === "in" ? "incomeCategory" : "category"]: r.category,
  project: r.project,
  stage: r.stage,
});

/** A remembered party edited or forgotten on the bank statements page. */
export async function auditPartyRule(before: RuleLike, after: RuleLike | null): Promise<void> {
  await auditSafely(async (): Promise<AuditEntry | null> => {
    const salary = before.category === "salaries" || after?.category === "salaries";
    // Now a salary payee: its earlier entries are hidden from roles without salaries too.
    if (after?.category === "salaries" && before.category !== "salaries") await hideEarlierAsSalary("bank_party_rule", before._id);
    const entity = { type: "bank_party_rule" as const, id: String(before._id), label: ruleLabel(before) };
    if (!after) return { action: "deleted", entity, changes: snapshotChanges(ruleSnapshot(before), "from"), salary };
    const changes = diffSnapshots(ruleSnapshot(before), ruleSnapshot(after));
    if (!changes.length) return null;
    return { action: "rule_changed", entity, changes, salary };
  });
}
