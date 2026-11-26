import { z } from "zod";
import { BANK_LINE_ACTIONS, INCOME_CATEGORIES, PAYMENT_METHODS, PROJECT_STAGES, valuesOf } from "@/lib/constants";
import { MAX_MONEY, dateInput, objectId, optionalObjectId, optionalText } from "@/lib/zod";
import { MAX_STATEMENT_LINES } from "./parse/statement";
import type { StatementMethod } from "./types";

/** Validation shared by the bank statement page (client) and its actions (server). Client-safe. */

/** Payment methods a bank statement line can carry. Credit, stock and the group company never move this account's money. */
export const STATEMENT_METHODS = ["bank_transfer", "upi", "card", "cheque", "cash", "other"] as const satisfies readonly StatementMethod[];

export const STATEMENT_METHOD_OPTIONS = PAYMENT_METHODS.filter((m) => (STATEMENT_METHODS as readonly string[]).includes(m.value));

/** Lines sent to the add action in one call: each call finishes well inside a minute. */
export const ADD_BATCH = 150;

const amount = z.number().finite().min(0).max(MAX_MONEY);

export const statementLineSchema = z.object({
  line: z.number().int().min(0),
  page: z.number().int().optional(),
  date: dateInput,
  valueDate: dateInput.optional(),
  narration: z.string().trim().max(1000),
  reference: optionalText(120),
  withdrawal: amount,
  deposit: amount,
  balance: z.number().finite().nullable(),
  check: z.enum(["ok", "fixed", "mismatch", "unchecked"]),
  issues: z.array(z.string().max(300)).max(10),
  /** From the file's own vendor and category columns, when mapped. Never part of the line's hash. */
  vendor: optionalText(200),
  category: optionalText(80),
});

export const reviewStatementSchema = z.object({
  accountId: objectId,
  lines: z.array(statementLineSchema).min(1, "The statement has no lines").max(MAX_STATEMENT_LINES),
});

export const lineDecisionSchema = z.object({
  action: z.enum(valuesOf(BANK_LINE_ACTIONS)),
  matchKey: z
    .string()
    .regex(/^[a-zA-Z]+:[a-f\d]{24}$/i)
    .optional(),
  party: optionalText(200),
  category: optionalText(80),
  incomeCategory: z.enum(valuesOf(INCOME_CATEGORIES)).optional(),
  projectId: optionalObjectId,
  stage: z.enum(valuesOf(PROJECT_STAGES)).optional(),
  paymentMethod: z.enum(STATEMENT_METHODS),
  description: optionalText(1000),
  otherAccountId: optionalObjectId,
  loanId: optionalObjectId,
  principal: amount.optional(),
  interest: amount.optional(),
  loanName: optionalText(160),
  loanGroup: optionalText(80),
  holderId: optionalObjectId,
});

export const addLinesSchema = z.object({
  accountId: objectId,
  /** Null on the first batch: the statement record is made when the first line is added. */
  statementId: optionalObjectId.nullable(),
  statement: z.object({
    fileName: z.string().trim().max(260),
    from: dateInput.nullable(),
    to: dateInput.nullable(),
    opening: z.number().finite().nullable(),
    closing: z.number().finite().nullable(),
    lines: z.number().int().min(0).max(MAX_STATEMENT_LINES),
  }),
  lines: z
    .array(statementLineSchema.extend({ occurrence: z.number().int().min(0).max(MAX_STATEMENT_LINES), decision: lineDecisionSchema }))
    .min(1)
    .max(ADD_BATCH),
});

export type ReviewStatementInput = z.input<typeof reviewStatementSchema>;
export type AddLinesInput = z.input<typeof addLinesSchema>;
export type AddLinesValues = z.output<typeof addLinesSchema>;
export type LineDecisionValues = z.output<typeof lineDecisionSchema>;
export type AddLineValues = AddLinesValues["lines"][number];

export const statementIdSchema = z.object({ id: objectId });

/** A remembered party, edited on the bank statements page. Empty category or project clears it. */
export const partyRuleSchema = z.object({
  id: objectId,
  party: z.string().trim().min(1, "Enter the name").max(200),
  category: optionalText(80),
  projectId: optionalObjectId,
  stage: z.enum(valuesOf(PROJECT_STAGES)).optional(),
});
export const partyRuleIdSchema = z.object({ id: objectId });
export type PartyRuleInput = z.input<typeof partyRuleSchema>;
/** One stored statement line (a BankTransaction). */
export const statementLineIdSchema = z.object({ id: objectId });
