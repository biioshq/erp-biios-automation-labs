/**
 * Opening stock entered as already on hand: units an item had when it was added, not bought then
 * (recordOpeningStock with asPurchase false). No expense was booked for them and their real
 * purchase date is unknown. Client-safe.
 *
 * Newer movements carry `openingOnHand: true`. Older ones are known only by the note the ledger
 * wrote on them, which starts with OPENING_ON_HAND_NOTE.
 */

/** The note the ledger writes on opening stock already on hand. Never change it: older records are matched by it. */
export const OPENING_ON_HAND_NOTE = "Opening stock, already on hand";

/** Whether a movement is opening stock already on hand, by its flag or, for older records, its note. */
export function isOpeningOnHand(m: { openingOnHand?: boolean | null; note?: string | null }): boolean {
  return m.openingOnHand === true || Boolean(m.note?.startsWith(OPENING_ON_HAND_NOTE));
}

/**
 * Mongo filter fragment that leaves out opening stock already on hand (by the flag, or the note on
 * older records). Records without a note or flag pass. It is a single `$nor`, so spreading it
 * keeps a filter's own `note` or `openingOnHand` condition; only a filter with its own `$nor`
 * would lose one (combine them under `$and` then).
 */
export const NOT_OPENING_ON_HAND: Record<string, unknown> = {
  $nor: [{ openingOnHand: true }, { note: new RegExp(`^${OPENING_ON_HAND_NOTE}`) }],
};
