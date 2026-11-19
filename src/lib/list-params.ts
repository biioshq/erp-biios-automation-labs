/**
 * URL state for list pages: ?q=steel&page=2&size=20&sort=date.desc&status=low_stock,out_of_stock&from=2026-04-01&to=2026-11-30
 * Parsed on the server (page.tsx → query) and written by the client DataTable. Client-safe.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export type ListParams = {
  q: string;
  page: number;
  pageSize: number;
  sort: { id: string; desc: boolean } | null;
  /** Multi-value filters by key, e.g. { category: ["materials", "travel"] } */
  filters: Record<string, string[]>;
  from: string | null;
  to: string | null;
};

export const PAGE_SIZES = [10, 20, 50, 100] as const;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListParams(
  sp: SearchParams,
  options: { filterKeys?: readonly string[]; defaultSort?: { id: string; desc: boolean }; sortable?: readonly string[]; defaultPageSize?: number } = {},
): ListParams {
  const page = Math.max(1, Number.parseInt(first(sp.page), 10) || 1);
  const sizeRaw = Number.parseInt(first(sp.size), 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : (options.defaultPageSize ?? 20);

  let sort = options.defaultSort ?? null;
  const sortRaw = first(sp.sort);
  if (sortRaw) {
    const [id, dir] = sortRaw.split(".");
    if (id && (!options.sortable || options.sortable.includes(id))) sort = { id, desc: dir === "desc" };
  }

  const filters: Record<string, string[]> = {};
  for (const key of options.filterKeys ?? []) {
    const values = first(sp[key]).split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length) filters[key] = values;
  }

  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    q: first(sp.q).trim().slice(0, 100),
    page,
    pageSize,
    sort,
    filters,
    from: date(first(sp.from)),
    to: date(first(sp.to)),
  };
}

/** A paginated result as the DataTable expects it. */
export type Paginated<T> = { rows: T[]; total: number; page: number; pageSize: number };

/** Escapes user input for a case-insensitive Mongo regex search. */
export function searchRegex(q: string): RegExp {
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** Mongo sort object from ListParams, with a stable tiebreaker. */
export function mongoSort(sort: ListParams["sort"], map: Record<string, string> = {}): Record<string, 1 | -1> {
  if (!sort) return { _id: -1 };
  const field = map[sort.id] ?? sort.id;
  return { [field]: sort.desc ? -1 : 1, _id: -1 };
}
