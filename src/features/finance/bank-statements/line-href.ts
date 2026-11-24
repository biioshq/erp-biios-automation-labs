/**
 * The page of one bank statement line: /finance/bank-statements?line=<id> opens the statement
 * holding it, scrolled to the line and highlighted, where an admin can unmatch it. Shared by the
 * record drawers and by the messages of actions that refuse a change because of the line.
 */
export const bankLineHref = (id: string) => `/finance/bank-statements?line=${encodeURIComponent(id)}`;

/** " Unmatch the line in Bank statements first: <url>" for one or more lines (two for a transfer between two accounts with statements). */
export function unmatchHint(ids: string[]): string {
  if (!ids.length) return " Unmatch the line in Bank statements first.";
  if (ids.length === 1) return ` Unmatch the line in Bank statements first: ${bankLineHref(ids[0]!)}`;
  const urls = ids.map(bankLineHref);
  return ` Unmatch ${ids.length === 2 ? "both lines" : `all ${ids.length} lines`} in Bank statements first: ${urls.slice(0, -1).join(", ")} and ${urls[urls.length - 1]}`;
}
