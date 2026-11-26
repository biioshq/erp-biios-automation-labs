import "server-only";

import { Types } from "mongoose";
import { BankPartyRule, Expense, Income } from "@/server/models";
import { isDuplicateKeyError } from "@/server/errors";
import { requireIndexes } from "@/server/new-indexes";
import { COMPANY } from "@/config/company";
import type { ProjectStage } from "@/lib/constants";
import type { StatementLine } from "../types";
import type { AddLineValues } from "../schemas";
import { analyseNarration, nameKey, nameTest, type NarrationInfo } from "../parse/narration";
import type { LinkRef } from "./links";

/**
 * Remembered parties: what the review learned from lines that were added. A rule is keyed by the
 * name the statement shows (or the UPI handle when there is no name) and says which vendor or
 * client that is, and the category, project and stage chosen for it last time. The review checks
 * rules first (review.ts suggest). Rules never book anything by themselves.
 */

export type Side = "in" | "out";

export type PartyRule = {
  id: string;
  side: Side;
  key: string;
  token: string | null;
  party: string;
  category: string | null;
  projectId: string | null;
  stage: ProjectStage | null;
  hits: number;
};

export type RuleBook = {
  byKey: Map<string, PartyRule>;
  byToken: Map<string, PartyRule>;
  all: PartyRule[];
  /** Each rule's name test, worked out once per review (a review may hold thousands of lines). */
  tests: { rule: PartyRule; test: (padded: string, flat: string) => boolean }[];
};

/** Rules are read whole for a review; past this many the oldest unused ones are left out. */
const MAX_RULES = 5000;

const bookKey = (side: Side, k: string) => `${side}|${k}`;

/**
 * How the statement names the other side of a line: the file's own vendor column first, else the
 * payee read from the narration, else the UPI handle. Null when the line names nobody.
 */
export function statementKeyOf(line: Pick<StatementLine, "vendor">, info: Pick<NarrationInfo, "payee" | "vpa">): { key: string; token: string | null } | null {
  const token = info.vpa ? info.vpa.toLowerCase().slice(0, 120) : null;
  const name = nameKey(line.vendor) || nameKey(info.payee);
  if (name.replace(/ /g, "").length >= 3) return { key: name.slice(0, 200), token };
  if (token) return { key: token, token };
  return null;
}

export async function loadRules(): Promise<RuleBook> {
  const docs = await BankPartyRule.find({}, { side: 1, key: 1, token: 1, party: 1, category: 1, project: 1, stage: 1, hits: 1 })
    .sort({ lastUsedAt: -1 })
    .limit(MAX_RULES)
    .lean();
  const book: RuleBook = { byKey: new Map(), byToken: new Map(), all: [], tests: [] };
  for (const d of docs) {
    const r: PartyRule = {
      id: String(d._id),
      side: d.side as Side,
      key: d.key,
      token: d.token ?? null,
      party: d.party,
      category: d.category ?? null,
      projectId: d.project ? String(d.project) : null,
      stage: (d.stage as ProjectStage | undefined) ?? null,
      hits: d.hits ?? 0,
    };
    book.all.push(r);
    const test = nameTest(r.party);
    if (test) book.tests.push({ rule: r, test });
    book.byKey.set(bookKey(r.side, r.key), r);
    // The most recently used rule answers for a handle seen with several names.
    if (r.token && !book.byToken.has(bookKey(r.side, r.token))) book.byToken.set(bookKey(r.side, r.token), r);
  }
  return book;
}

/**
 * The rule for a line: by its UPI handle, then by the name the statement shows, then a remembered
 * party whose name is written out in the narration (the longest such name).
 */
export function findRule(book: RuleBook, side: Side, line: Pick<StatementLine, "vendor" | "narration">, info: NarrationInfo): PartyRule | null {
  return findRuleHit(book, side, line, info)?.rule ?? null;
}

/**
 * findRule with how the rule was found: "token" and "key" are the name or handle the statement
 * shows; "name" is a remembered party's name read inside the narration, which is looser (a rule
 * for "Amazon" is found in "AMAZON WEB SERVICES").
 */
export function findRuleHit(
  book: RuleBook,
  side: Side,
  line: Pick<StatementLine, "vendor" | "narration">,
  info: NarrationInfo,
): { rule: PartyRule; by: "token" | "key" | "name" } | null {
  if (!book.all.length) return null;
  if (info.vpa) {
    const byToken = book.byToken.get(bookKey(side, info.vpa.toLowerCase()));
    if (byToken) return { rule: byToken, by: "token" };
  }
  const k = statementKeyOf(line, info);
  if (k) {
    const byKey = book.byKey.get(bookKey(side, k.key));
    if (byKey) return { rule: byKey, by: "key" };
  }
  let best: PartyRule | null = null;
  const padded = ` ${nameKey(`${line.narration} ${line.vendor ?? ""}`)} `;
  const flat = padded.replace(/ /g, "");
  for (const { rule, test } of book.tests) {
    if (rule.side !== side) continue;
    if (test(padded, flat) && (!best || rule.party.length > best.party.length)) best = rule;
  }
  return best ? { rule: best, by: "name" } : null;
}

/** Bank-only lines (charges, interest, cash withdrawals) are never remembered: the review knows them already. */
const UNLEARNED_KINDS = new Set(["charges", "interest", "atm"]);

/** `chosen`: the line was made into a new record, so its project (or no project) is the latest choice. */
type Lesson = { party: string; category?: string; projectId?: string; stage?: string; chosen?: boolean };

async function lessonOf(l: AddLineValues, link: LinkRef | null): Promise<Lesson | null> {
  const d = l.decision;
  if (d.action === "expense" && l.withdrawal > 0 && d.party) {
    return { party: d.party, category: d.category, projectId: d.projectId, stage: d.projectId ? d.stage : undefined, chosen: true };
  }
  if (d.action === "income" && l.deposit > 0 && d.party) {
    return { party: d.party, category: d.incomeCategory, projectId: d.projectId, chosen: true };
  }
  if (d.action !== "match" || !link) return null;
  // A line matched to a record: the name on the statement is that record's vendor or client.
  // A salary payment's rule is marked salaries, so it stays hidden from people who may not see salaries.
  const fromExpense = (e: { vendor?: string | null; category?: string | null } | null): Lesson | null =>
    e?.vendor ? { party: e.vendor, ...(e.category === "salaries" ? { category: "salaries" } : {}) } : null;
  if (link.kind === "expense") return fromExpense(await Expense.findById(link.id, { vendor: 1, category: 1 }).lean());
  if (link.kind === "expensePayment") return fromExpense(await Expense.findOne({ "payments._id": new Types.ObjectId(link.id) }, { vendor: 1, category: 1 }).lean());
  if (link.kind === "income") {
    const i = await Income.findById(link.id, { client: 1 }).lean();
    return i?.client ? { party: i.client } : null;
  }
  return null;
}

/**
 * Remembers what a line was made into. Called after the line's record is saved and tied to it;
 * best effort: a failure is logged and never fails the add. Rules are upserted on their unique
 * (side, key) index, so requireIndexes runs first: without the index two adds at once could make
 * two rules for one name. `salaries`: the person may see salaries. Without it, a rule remembered
 * as a salary payment is left as it is, as the Remembered parties page would leave it.
 */
export async function learnFromLine(l: AddLineValues, link: LinkRef | null, userId: string, salaries = false): Promise<void> {
  try {
    const side: Side = l.withdrawal > 0 ? "out" : "in";
    const info = analyseNarration(l.narration, side === "out" ? "dr" : "cr", { exclude: [COMPANY.name] });
    if (info.kind && UNLEARNED_KINDS.has(info.kind)) return;
    const k = statementKeyOf(l, info);
    if (!k) return;
    const lesson = await lessonOf(l, link);
    if (!lesson) return;
    await requireIndexes(BankPartyRule);
    const user = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;
    const set: Record<string, unknown> = { party: lesson.party.trim().slice(0, 200), lastUsedAt: new Date() };
    if (k.token) set.token = k.token;
    if (lesson.category) set.category = lesson.category;
    const unset: Record<string, 1> = {};
    if (lesson.projectId && Types.ObjectId.isValid(lesson.projectId)) {
      set.project = new Types.ObjectId(lesson.projectId);
      // An income rule keeps no stage; an expense rule's stage goes with its project.
      if (lesson.stage) set.stage = lesson.stage;
      else unset.stage = 1;
    } else if (lesson.chosen) {
      // Added without a project: the project suggested from this rule was taken off, so it is not suggested again.
      unset.project = 1;
      unset.stage = 1;
    }
    if (user) set.updatedBy = user;
    // Without the salaries permission a salary rule is not matched, so it is not changed (an insert then hits the unique index and stops).
    const filter = { side, key: k.key, ...(salaries || lesson.category === "salaries" ? {} : { category: { $ne: "salaries" } }) };
    const changes = { $set: set, $inc: { hits: 1 }, ...(Object.keys(unset).length ? { $unset: unset } : {}) };
    try {
      await BankPartyRule.updateOne(filter, { ...changes, ...(user ? { $setOnInsert: { createdBy: user } } : {}) }, { upsert: true });
    } catch (error) {
      // Two adds learned the same new name at the same moment: the other one made the rule, so update it.
      if (!isDuplicateKeyError(error)) throw error;
      await BankPartyRule.updateOne(filter, changes);
    }
  } catch (error) {
    console.error("[bank-statements] could not remember the party of a line", error);
  }
}
