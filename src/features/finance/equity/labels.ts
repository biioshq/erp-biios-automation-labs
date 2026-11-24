import { CAPITAL_ENTRY_TYPES, PAYMENT_METHODS, labelOf, type CapitalEntryType, type EquityHolderKind, type PaymentMethod } from "@/lib/constants";
import type { Tone } from "@/components/shared/status-badge";

/** Labels and options shared by the equity pages. Client-safe. */

/** Entry types that move money in or out of a bank or cash account. */
export const MONEY_ENTRY_TYPES: CapitalEntryType[] = ["capital", "drawing", "dividend"];
export const isMoneyEntry = (type: CapitalEntryType) => MONEY_ENTRY_TYPES.includes(type);

/** Capital is never paid "from stock" or "on credit": money either came in or it did not. */
export const EQUITY_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "stock" && m.value !== "credit");
export const EQUITY_PAYMENT_VALUES = EQUITY_PAYMENT_METHODS.map((m) => m.value) as [PaymentMethod, ...PaymentMethod[]];

export const ENTRY_TONES: Record<CapitalEntryType, Tone> = {
  capital: "success",
  drawing: "warning",
  dividend: "info",
  reserve_transfer: "violet",
  opening_retained: "neutral",
};

export const entryTypeLabel = (type: CapitalEntryType) => labelOf(CAPITAL_ENTRY_TYPES, type);

export const HOLDER_KIND_LABELS: Record<EquityHolderKind, { one: string; many: string; href: string }> = {
  owner: { one: "Owner", many: "Owners", href: "/finance/equity/owners" },
  investor: { one: "Investor", many: "Investors", href: "/finance/equity/investors" },
};

/** Title of the create form for each entry type. */
export const NEW_ENTRY_TITLES: Record<CapitalEntryType, { title: string; description: string; submit: string }> = {
  capital: { title: "Record capital", description: "Money an owner or investor put into the business. It is equity, never income.", submit: "Record capital" },
  drawing: { title: "Record drawing", description: "Money an owner took out of the business for personal use. It reduces their capital, it is not an expense.", submit: "Record drawing" },
  dividend: { title: "Record dividend", description: "Profit paid out to owners or investors. It comes out of retained earnings.", submit: "Record dividend" },
  reserve_transfer: { title: "Transfer to reserve", description: "Sets part of retained earnings aside in a reserve. No money moves.", submit: "Transfer to reserve" },
  opening_retained: {
    title: "Retained earnings before the books started",
    description: "The accumulated profit (or loss, as a negative amount) the company had on the day it started recording in this ERP.",
    submit: "Save opening figure",
  },
};

