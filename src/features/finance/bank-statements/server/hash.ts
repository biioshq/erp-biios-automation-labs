import "server-only";

import { createHash } from "node:crypto";

type HashableLine = { date: string; narration: string; withdrawal: number; deposit: number; balance: number | null };

/** What makes two lines the same: account, day, amount, side, narration and balance. */
function baseKey(accountId: string, l: HashableLine): string {
  const side = l.withdrawal > 0 ? "dr" : "cr";
  const amount = (l.withdrawal > 0 ? l.withdrawal : l.deposit).toFixed(2);
  const narration = l.narration.toLowerCase().replace(/\s+/g, " ").trim();
  return [accountId, l.date, amount, side, narration, l.balance === null ? "" : l.balance.toFixed(2)].join("|");
}

/**
 * The line's identity in the account, stored unique per account on its BankTransaction.
 * `occurrence` tells apart identical lines in one statement (two equal charges on one day with no
 * balance printed): the first has none, so the same line in another file hashes the same.
 */
export function lineHash(accountId: string, l: HashableLine, occurrence = 0): string {
  const key = baseKey(accountId, l) + (occurrence > 0 ? `#${occurrence}` : "");
  return createHash("sha256").update(key).digest("hex");
}

/** How many identical lines come before each line of the statement. */
export function occurrences(accountId: string, lines: HashableLine[]): number[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const k = baseKey(accountId, l);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n;
  });
}
