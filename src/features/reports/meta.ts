import {
  ArrowLeftRight,
  Armchair,
  Banknote,
  Boxes,
  CalendarDays,
  Calculator,
  ChartLine,
  ChartPie,
  FileBarChart,
  FileClock,
  FlaskConical,
  FolderKanban,
  HandCoins,
  Landmark,
  ListChecks,
  Receipt,
  Scale,
  Store,
  TrendingDown,
  TrendingUp,
  UsersRound,
  Vault,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReportType } from "@/lib/constants";
import { REPORT_CATALOG, REPORT_GROUPS, type ReportInfo } from "./catalog";

export { REPORT_GROUPS, isLegacyReport, mayExportReport, reportPermissions, type ReportFilterKey, type ReportGroup } from "./catalog";

const ICONS: Record<ReportType, LucideIcon> = {
  finance: TrendingUp,
  expense: Receipt,
  income: Landmark,
  gst: Calculator,
  project: FolderKanban,
  inventory: Boxes,
  ca: FileBarChart,
  balance_sheet: Scale,
  profit_loss: ChartLine,
  cash_flow: ArrowLeftRight,
  trial_balance: ListChecks,
  receivables: HandCoins,
  payables: FileClock,
  liabilities: Banknote,
  fixed_assets: Armchair,
  depreciation: TrendingDown,
  equity: Vault,
  project_financials: ChartPie,
  cash_budget: Wallet,
  daily: CalendarDays,
  vendor_statement: Store,
  customer_statement: UsersRound,
  // Scenario exports are logged in the export history; they are not a card in the picker.
  scenario: FlaskConical,
};

/** A report as the cards show it: the catalog entry with its icon. */
export type ReportMeta = ReportInfo & { icon: LucideIcon };

export const REPORT_META: ReportMeta[] = REPORT_CATALOG.map((m) => ({ ...m, icon: ICONS[m.type] }));

export const metaOf = (type: string | undefined) => REPORT_META.find((m) => m.type === type);

/** The icon of a logged export, scenario exports included (they have no card). */
export const reportIcon = (type: string): LucideIcon | undefined => ICONS[type as ReportType];

/** Card order inside each group: the statements first, then the registers that feed them. */
const CARD_ORDER: ReportType[] = [
  "balance_sheet",
  "profit_loss",
  "cash_flow",
  "trial_balance",
  "finance",
  "ca",
  "income",
  "receivables",
  "customer_statement",
  "expense",
  "vendor_statement",
  "gst",
  "fixed_assets",
  "depreciation",
  "inventory",
  "payables",
  "liabilities",
  "equity",
  "project",
  "project_financials",
  "cash_budget",
];

/**
 * The report cards a viewer may open, under their group headings. Groups with no card are left out.
 * `allowed` is the set of report types the viewer may build (see mayExportReport).
 */
export function reportGroupsFor(allowed: ReadonlySet<ReportType>) {
  const rank = (t: ReportType) => {
    const i = CARD_ORDER.indexOf(t);
    return i < 0 ? CARD_ORDER.length : i;
  };
  return REPORT_GROUPS.map((g) => ({
    ...g,
    reports: REPORT_META.filter((m) => m.group === g.key && allowed.has(m.type)).sort((a, b) => rank(a.type) - rank(b.type)),
  })).filter((g) => g.reports.length > 0);
}
