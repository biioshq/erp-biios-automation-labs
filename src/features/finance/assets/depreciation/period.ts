import { endOfDayIST, financialYearIST, fromDateInput, toDateInput } from "@/lib/dates";

/**
 * The period of the depreciation summary, read from the URL. Client-safe.
 *   ?fy=2025              the financial year April 2025 to March 2026
 *   ?from=…&to=…          custom dates (both IST days, inclusive)
 *   nothing               this financial year, up to today
 * A period never runs past today: depreciation after today has not been charged yet.
 */
export type DepreciationPeriod = {
  mode: "fy" | "custom";
  /** Start year of the financial year, for mode "fy". */
  fyStart: number | null;
  from: string;
  to: string;
  label: string;
  /** True when `to` was cut back to today. */
  toToday: boolean;
};

export type AssetKindFilter = "all" | "tangible" | "intangible";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(fromDateInput(v).getTime());

export const fyLabel = (startYear: number) => `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

export function currentFyStart(now = new Date()): number {
  return Number(financialYearIST(now).label.slice(3, 7));
}

export function parseDepreciationPeriod(sp: Record<string, string | string[] | undefined>, now = new Date()): DepreciationPeriod {
  const today = toDateInput(now);
  const cap = (to: string) => (to > today ? { to: today, toToday: true } : { to, toToday: false });
  const from = first(sp.from);
  const to = first(sp.to);
  if (isDay(from) || isDay(to)) {
    // Both ends are capped at today, so dates picked in the future never show planned charges as charged.
    const f = cap(isDay(from) ? from : toDateInput(financialYearIST(now).start));
    const t = cap(isDay(to) ? to : today);
    const [a, b] = f.to <= t.to ? [f.to, t.to] : [t.to, f.to];
    return { mode: "custom", fyStart: null, from: a, to: b, label: "Custom dates", toToday: t.toToday || f.toToday };
  }
  const fyRaw = Number.parseInt(first(sp.fy), 10);
  const current = currentFyStart(now);
  const fy = Number.isFinite(fyRaw) && fyRaw >= 1990 && fyRaw <= current ? fyRaw : current;
  const start = `${fy}-04-01`;
  const end = toDateInput(endOfDayIST(new Date(fromDateInput(`${fy + 1}-04-01`).getTime() - 1)));
  const t = cap(end);
  return { mode: "fy", fyStart: fy, from: start, to: t.to, label: fyLabel(fy), toToday: t.toToday };
}

export function parseKind(v: string | string[] | undefined): AssetKindFilter {
  const k = first(v);
  return k === "tangible" || k === "intangible" ? k : "all";
}
