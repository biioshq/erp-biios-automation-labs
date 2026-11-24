import "server-only";

import { getBankAccountOptions, getEmployeeOptions, getProjectOptions, getVendorNames } from "@/server/lookups";
import { loadFinanceGroups } from "@/server/finance-groups";
import type { SearchParams } from "@/lib/list-params";
import { parseListParams } from "@/lib/list-params";
import { allowedGroupKeys, getAssetLocations, listAssets } from "./queries";
import { ASSET_FILTER_KEYS } from "./schemas";
import type { AssetKind } from "./labels";
import type { RegisterLayout } from "./components/asset-toolbar";

/** Everything the fixed and intangible register pages load, in one place so both stay the same. */
export async function loadAssetPage(kind: AssetKind, sp: SearchParams) {
  const params = parseListParams(sp, { filterKeys: ASSET_FILTER_KEYS });
  const layout: RegisterLayout = sp.layout === "register" ? "register" : "groups";
  const [register, allGroups, accounts, employees, projects, vendors, locations] = await Promise.all([
    listAssets(kind, { q: params.q, filters: params.filters }),
    loadFinanceGroups("asset"),
    getBankAccountOptions(),
    getEmployeeOptions(),
    getProjectOptions(),
    getVendorNames(),
    getAssetLocations(kind),
  ]);
  const allowed = new Set(allowedGroupKeys(allGroups, kind));
  const groups = allGroups.filter((g) => allowed.has(g.key));
  return { register, groups, layout, options: { groups, accounts, employees, projects, vendors, locations } };
}
