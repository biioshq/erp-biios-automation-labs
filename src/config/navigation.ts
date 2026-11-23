import {
  Upload,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BadgeIndianRupee,
  Boxes,
  CalendarDays,
  CircleCheckBig,
  CircleDashed,
  CircleSlash,
  ClipboardList,
  Eye,
  FileBarChart,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Loader,
  PackagePlus,
  Receipt,
  Tags,
  TriangleAlert,
  UserRound,
  Repeat,
  Users,
  Wallet,
  AlarmClock,
  Activity,
  Armchair,
  Banknote,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarRange,
  ChartColumn,
  ChartNoAxesCombined,
  CircleAlert,
  Columns3,
  FileText,
  FlaskConical,
  Gauge,
  HandCoins,
  History,
  Hourglass,
  IndianRupee,
  KeyRound,
  Landmark,
  Lightbulb,
  LineChart,
  ListChecks,
  ListTree,
  PiggyBank,
  Plus,
  Scale,
  Store,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Vault,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * The single source of truth for navigation: the sidebar, breadcrumbs and the
 * command palette all read this. A future module (HR, CRM, Payroll …) is one
 * more entry in MODULES.
 */

export type NavItem = {
  /** The page's name, as breadcrumbs and the command palette show it. */
  title: string;
  href: string;
  icon: LucideIcon;
  /** Extra words the command palette matches on. */
  keywords?: string[];
  /** Match only the exact path (for module dashboards). */
  exact?: boolean;
  /** Shorter label when the page shows as a section tab. Defaults to the title. */
  tab?: string;
  /**
   * Pages that sit under this entry. The sidebar lists only the parent; the
   * children show as tabs at the top of each of these pages. The first child
   * usually shares the parent's href.
   */
  children?: NavItem[];
};

export type NavModule = {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Module root, also its dashboard. */
  href: string;
  /** Sidebar entries. An entry with children opens as a collapsible group in the sidebar, and its children also show as tabs. */
  items: NavItem[];
};

export const MODULES: NavModule[] = [
  {
    id: "finance",
    title: "Finance",
    icon: Wallet,
    href: "/finance",
    items: [
      { title: "Dashboard", href: "/finance", icon: LayoutDashboard, exact: true, keywords: ["overview", "profit", "cash position"] },
      {
        title: "Income",
        href: "/finance/income",
        icon: BadgeIndianRupee,
        keywords: ["revenue", "payments", "client"],
        children: [
          { title: "Income records", tab: "Income", href: "/finance/income", icon: BadgeIndianRupee, keywords: ["revenue", "payments", "client"] },
          { title: "Invoices & receivables", tab: "Invoices", href: "/finance/invoices", icon: FileText, keywords: ["invoice", "receivable", "outstanding", "customer", "billing"] },
          { title: "Income summary", tab: "Summary", href: "/finance/income/summary", icon: ChartColumn, keywords: ["daily", "monthly", "yearly", "customer-wise", "project-wise"] },
        ],
      },
      {
        title: "Expenses",
        href: "/finance/expenses",
        icon: Receipt,
        keywords: ["bills", "spend", "gst", "vendor"],
        children: [
          { title: "Expense records", tab: "Expenses", href: "/finance/expenses", icon: Receipt, keywords: ["bills", "spend", "gst", "vendor", "direct", "indirect"] },
          { title: "Payment tracking", tab: "Payments", href: "/finance/payments", icon: CalendarClock, keywords: ["unpaid", "partly paid", "overdue", "upcoming", "due"] },
          {
            title: "Recurring expenses",
            tab: "Recurring",
            href: "/finance/recurring",
            icon: Repeat,
            keywords: ["salary", "salaries", "rent", "bills", "subscriptions", "monthly"],
          },
          { title: "Bank statements", tab: "Bank statements", href: "/finance/bank-statements", icon: Landmark, keywords: ["statement", "deposit", "withdrawal", "reconcile", "bank"] },
          { title: "Import", href: "/finance/import", icon: Upload, keywords: ["csv", "bulk", "google drive", "bills", "receipts", "income"] },
          { title: "Expense summary", tab: "Summary", href: "/finance/expenses/summary", icon: ChartColumn, keywords: ["category-wise", "vendor-wise", "monthly", "paid vs unpaid"] },
        ],
      },
      {
        title: "Projects",
        href: "/finance/projects",
        icon: FolderKanban,
        keywords: ["budget", "client"],
        children: [
          { title: "Projects", href: "/finance/projects", icon: FolderKanban, keywords: ["budget", "client"] },
          { title: "Profitability", href: "/finance/projects/profitability", icon: TrendingUp, keywords: ["profit", "margin", "project income", "project expenses"] },
          { title: "Budget tracking", tab: "Budgets", href: "/finance/projects/budgets", icon: Gauge, keywords: ["budget vs actual", "overrun", "variance"] },
          { title: "Employees", href: "/finance/employees", icon: Users, keywords: ["staff", "people", "team", "payroll", "salary"] },
        ],
      },
      {
        title: "Assets",
        href: "/finance/assets",
        icon: Building2,
        keywords: ["balance sheet", "what we own"],
        children: [
          { title: "Assets overview", tab: "Overview", href: "/finance/assets", icon: Building2, exact: true, keywords: ["total assets"] },
          { title: "Cash & bank", href: "/finance/assets/cash", icon: Landmark, keywords: ["bank balance", "cash in hand", "accounts", "opening balance"] },
          { title: "Receivables", href: "/finance/assets/receivables", icon: HandCoins, keywords: ["accounts receivable", "customers owe"] },
          { title: "Prepaid expenses", tab: "Prepaid", href: "/finance/assets/prepaid", icon: CalendarRange, keywords: ["advance paid", "insurance", "annual"] },
          { title: "Inventory valuation", tab: "Inventory", href: "/finance/assets/inventory", icon: Boxes, keywords: ["stock in storage", "stock in use", "wasted stock"] },
          { title: "Fixed assets", href: "/finance/assets/fixed", icon: Armchair, keywords: ["furniture", "machinery", "vehicles", "computers", "register"] },
          { title: "Depreciation", href: "/finance/assets/depreciation", icon: TrendingDown, keywords: ["book value", "accumulated depreciation"] },
          { title: "Intangible assets", tab: "Intangible", href: "/finance/assets/intangible", icon: KeyRound, keywords: ["software", "licences", "amortisation"] },
          { title: "Investments", href: "/finance/assets/investments", icon: PiggyBank, keywords: ["fixed deposit", "mutual fund", "shares"] },
        ],
      },
      {
        title: "Liabilities",
        href: "/finance/liabilities",
        icon: Scale,
        keywords: ["owe", "debt", "balance sheet"],
        children: [
          { title: "Liabilities overview", tab: "Overview", href: "/finance/liabilities", icon: Scale, exact: true, keywords: ["total liabilities", "overdue"] },
          { title: "Accounts payable", tab: "Payables", href: "/finance/liabilities/payables", icon: Receipt, keywords: ["vendor dues", "unpaid bills", "suppliers"] },
          { title: "Loans & borrowings", tab: "Loans", href: "/finance/liabilities/loans", icon: Banknote, keywords: ["loan", "emi", "interest", "lender"] },
          { title: "Current liabilities", tab: "Current", href: "/finance/liabilities/current", icon: ListChecks, keywords: ["short-term", "taxes payable", "salaries payable", "customer advances"] },
          { title: "Non-current liabilities", tab: "Non-current", href: "/finance/liabilities/non-current", icon: ListTree, keywords: ["long-term", "term loan"] },
        ],
      },
      {
        title: "Capital / Equity",
        href: "/finance/equity",
        icon: Landmark,
        keywords: ["owner", "investor", "capital", "shareholders"],
        children: [
          { title: "Equity summary", tab: "Summary", href: "/finance/equity", icon: Landmark, exact: true, keywords: ["total equity"] },
          { title: "Owners' capital", tab: "Owners", href: "/finance/equity/owners", icon: UserRound, keywords: ["owner", "promoter", "capital introduced"] },
          { title: "Investors' capital", tab: "Investors", href: "/finance/equity/investors", icon: Users, keywords: ["investor", "shareholding", "ownership"] },
          { title: "Drawings", href: "/finance/equity/drawings", icon: ArrowUpFromLine, keywords: ["withdrawal", "owner drawings"] },
          { title: "Retained earnings", tab: "Retained", href: "/finance/equity/retained-earnings", icon: TrendingUp, keywords: ["accumulated profit", "dividends"] },
          { title: "Reserves & surplus", tab: "Reserves", href: "/finance/equity/reserves", icon: Vault, keywords: ["general reserve"] },
        ],
      },
      {
        title: "Reports",
        href: "/finance/reports",
        icon: FileBarChart,
        keywords: ["gst", "ca", "export", "pdf", "excel", "inventory", "stock valuation"],
        children: [
          { title: "Reports", tab: "All reports", href: "/finance/reports", icon: FileBarChart, keywords: ["gst", "ca", "export", "pdf", "excel", "inventory", "stock valuation"] },
          { title: "Balance sheet", href: "/finance/reports/balance-sheet", icon: Scale, keywords: ["assets", "liabilities", "equity", "position"] },
          { title: "Profit & loss", href: "/finance/reports/profit-loss", icon: TrendingUp, keywords: ["p&l", "income statement", "net profit"] },
          { title: "Cash flow", href: "/finance/reports/cash-flow", icon: ArrowLeftRight, keywords: ["cash inflow", "cash outflow"] },
          { title: "Trial balance", href: "/finance/reports/trial-balance", icon: ListChecks, keywords: ["ledger", "debit", "credit"] },
        ],
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    icon: Boxes,
    href: "/inventory",
    items: [
      { title: "Dashboard", href: "/inventory", icon: LayoutDashboard, exact: true, keywords: ["stock overview"] },
      {
        title: "Items",
        href: "/inventory/items",
        icon: Boxes,
        keywords: ["all inventory", "sku", "stock"],
        children: [
          { title: "All items", href: "/inventory/items", icon: Boxes, keywords: ["all inventory", "sku", "stock"] },
          { title: "Categories", href: "/inventory/categories", icon: Tags, keywords: ["item categories"] },
          { title: "Low stock", href: "/inventory/low-stock", icon: TriangleAlert, keywords: ["reorder", "out of stock"] },
          { title: "Import items", tab: "Import", href: "/inventory/import", icon: Upload, keywords: ["csv", "bulk", "google drive", "photos"] },
        ],
      },
      {
        title: "Stock in/out",
        href: "/inventory/purchase",
        icon: PackagePlus,
        keywords: ["purchase", "assign", "return", "stock in", "stock out", "transfer", "wastage"],
        children: [
          { title: "Purchase stock", tab: "Purchase", href: "/inventory/purchase", icon: PackagePlus, keywords: ["buy", "restock", "stock in"] },
          { title: "Assign to project", href: "/inventory/assign", icon: ArrowUpFromLine, keywords: ["allocate", "issue", "stock out"] },
          { title: "Return from project", href: "/inventory/return", icon: ArrowDownToLine, keywords: ["give back", "stock in"] },
          { title: "Stock transfer", tab: "Transfer", href: "/inventory/transfer", icon: ArrowLeftRight, keywords: ["move stock", "project to project", "location"] },
          { title: "Record wastage", tab: "Wastage", href: "/inventory/wastage", icon: Trash2, keywords: ["damaged", "expired", "lost", "write off"] },
        ],
      },
      { title: "Movements", href: "/inventory/movements", icon: ArrowLeftRight, keywords: ["stock movement", "history", "ledger"] },
    ],
  },
  {
    id: "analytics",
    title: "Analytics & Planning",
    icon: ChartNoAxesCombined,
    href: "/analytics",
    items: [
      { title: "Dashboard", href: "/analytics", icon: LayoutDashboard, exact: true, keywords: ["insights", "risks", "decision support"] },
      {
        title: "What-if scenarios",
        href: "/analytics/scenarios",
        icon: FlaskConical,
        keywords: ["what if", "simulate", "scenario planning"],
        children: [
          { title: "All scenarios", tab: "Scenarios", href: "/analytics/scenarios", icon: FlaskConical, keywords: ["saved scenarios", "drafts"] },
          { title: "New scenario", tab: "New", href: "/analytics/scenarios/new", icon: Plus, keywords: ["demand change", "supply delay", "new project", "price change", "budget", "manpower", "equipment"] },
        ],
      },
      {
        title: "Forecasting",
        href: "/analytics/forecasting",
        icon: LineChart,
        keywords: ["predict", "forecast"],
        children: [
          { title: "Inventory demand", tab: "Demand", href: "/analytics/forecasting", icon: Boxes, keywords: ["stockout", "coverage"] },
          { title: "Purchase requirements", tab: "Purchases", href: "/analytics/forecasting/purchases", icon: PackagePlus, keywords: ["reorder", "suggested purchase"] },
          { title: "Project cost forecast", tab: "Project cost", href: "/analytics/forecasting/projects", icon: FolderKanban, keywords: ["final cost", "overrun"] },
          { title: "Material consumption", tab: "Consumption", href: "/analytics/forecasting/consumption", icon: Activity, keywords: ["daily", "weekly", "monthly use"] },
          { title: "Equipment maintenance", tab: "Maintenance", href: "/analytics/forecasting/maintenance", icon: Wrench, keywords: ["service due"] },
          { title: "Manpower requirement", tab: "Manpower", href: "/analytics/forecasting/manpower", icon: Users, keywords: ["staffing", "hiring"] },
          { title: "Forecast vs actual", tab: "Accuracy", href: "/analytics/forecasting/accuracy", icon: Target, keywords: ["accuracy", "deviation"] },
        ],
      },
      {
        title: "Scenario comparison",
        href: "/analytics/compare",
        icon: Columns3,
        keywords: ["compare scenarios", "side by side"],
        children: [
          { title: "Compare scenarios", tab: "Compare", href: "/analytics/compare", icon: Columns3, keywords: ["side by side"] },
          { title: "Scenario history", tab: "History", href: "/analytics/compare/history", icon: History, keywords: ["changes", "approvals"] },
        ],
      },
      {
        title: "Inventory analytics",
        href: "/analytics/inventory",
        icon: Boxes,
        keywords: ["stock analytics"],
        children: [
          { title: "Stock movement analysis", tab: "Movement", href: "/analytics/inventory", icon: ArrowLeftRight, keywords: ["received", "issued", "trends"] },
          { title: "Fast and slow moving", tab: "Fast / slow", href: "/analytics/inventory/velocity", icon: Gauge, keywords: ["non-moving", "frequently used"] },
          { title: "Inventory ageing", tab: "Ageing", href: "/analytics/inventory/ageing", icon: Hourglass, keywords: ["0-30 days", "old stock"] },
          { title: "Overstock and understock", tab: "Levels", href: "/analytics/inventory/levels", icon: TriangleAlert, keywords: ["excess", "below minimum"] },
          { title: "Consumption trends", tab: "Consumption", href: "/analytics/inventory/consumption", icon: Activity, keywords: ["usage trend"] },
          { title: "Shortage risk", tab: "Shortage risk", href: "/analytics/inventory/shortages", icon: CircleAlert, keywords: ["stockout risk"] },
        ],
      },
      {
        title: "Project & cost analytics",
        href: "/analytics/projects",
        icon: FolderKanban,
        keywords: ["project analytics"],
        children: [
          { title: "Project cost analysis", tab: "Cost", href: "/analytics/projects", icon: IndianRupee, keywords: ["material cost", "labour cost"] },
          { title: "Budget vs actual", tab: "Budget vs actual", href: "/analytics/projects/budget", icon: Gauge, keywords: ["variance"] },
          { title: "Resource utilisation", tab: "Resources", href: "/analytics/projects/resources", icon: Users, keywords: ["materials", "equipment", "manpower"] },
          { title: "Cost overruns", tab: "Overruns", href: "/analytics/projects/overruns", icon: TriangleAlert, keywords: ["over budget"] },
          { title: "Project performance", tab: "Performance", href: "/analytics/projects/performance", icon: Target, keywords: ["progress", "delays"] },
        ],
      },
      {
        title: "Management insights",
        href: "/analytics/insights",
        icon: Lightbulb,
        keywords: ["management reports"],
        children: [
          { title: "Business performance", tab: "Overall", href: "/analytics/insights", icon: Briefcase, keywords: ["overview"] },
          { title: "Financial performance", tab: "Financial", href: "/analytics/insights/financial", icon: TrendingUp, keywords: ["revenue trend", "cash flow"] },
          { title: "Procurement analysis", tab: "Procurement", href: "/analytics/insights/procurement", icon: PackagePlus, keywords: ["purchase value", "price trend"] },
          { title: "Vendor performance", tab: "Vendors", href: "/analytics/insights/vendors", icon: Store, keywords: ["supplier"] },
          { title: "Operational efficiency", tab: "Efficiency", href: "/analytics/insights/efficiency", icon: Activity, keywords: ["utilisation", "wastage"] },
        ],
      },
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: ListTodo,
    href: "/tasks",
    items: [
      { title: "Dashboard", href: "/tasks", icon: LayoutDashboard, exact: true },
      {
        title: "All tasks",
        href: "/tasks/all",
        icon: ClipboardList,
        keywords: ["kanban", "board"],
        children: [
          { title: "All tasks", tab: "All", href: "/tasks/all", icon: ClipboardList, keywords: ["kanban", "board"] },
          { title: "Pending tasks", tab: "Pending", href: "/tasks/status/pending", icon: CircleDashed, keywords: ["not started"] },
          { title: "In progress tasks", tab: "In progress", href: "/tasks/status/in_progress", icon: Loader, keywords: ["working on"] },
          { title: "Review tasks", tab: "Review", href: "/tasks/status/review", icon: Eye, keywords: ["waiting for check"] },
          { title: "Completed tasks", tab: "Completed", href: "/tasks/status/completed", icon: CircleCheckBig, keywords: ["done", "finished"] },
          { title: "Overdue tasks", tab: "Overdue", href: "/tasks/status/overdue", icon: AlarmClock, keywords: ["late", "past due"] },
          { title: "Cancelled tasks", tab: "Cancelled", href: "/tasks/status/cancelled", icon: CircleSlash, keywords: ["dropped"] },
        ],
      },
      { title: "My tasks", href: "/tasks/mine", icon: UserRound, keywords: ["assigned to me"] },
      { title: "Calendar", href: "/tasks/calendar", icon: CalendarDays, keywords: ["schedule", "due dates"] },
    ],
  },
];

/** Quick actions for the command palette. `?new=1` opens the page's create drawer. */
export const QUICK_ACTIONS: NavItem[] = [
  { title: "Add expense", href: "/finance/expenses?new=1", icon: Receipt, keywords: ["new", "create", "bill", "receipt", "ocr"] },
  { title: "Add recurring expense", href: "/finance/recurring?new=1", icon: Repeat, keywords: ["salary", "rent", "bill", "subscription"] },
  { title: "Record income", href: "/finance/income?new=1", icon: BadgeIndianRupee, keywords: ["new", "payment received"] },
  { title: "Add employee", href: "/finance/employees?new=1", icon: Users, keywords: ["staff", "hire", "people"] },
  { title: "New project", href: "/finance/projects?new=1", icon: FolderKanban, keywords: ["create"] },
  { title: "Add inventory item", href: "/inventory/items?new=1", icon: Boxes, keywords: ["new", "sku"] },
  { title: "Purchase stock", href: "/inventory/purchase", icon: PackagePlus, keywords: ["buy"] },
  { title: "Assign stock to a project", href: "/inventory/assign", icon: ArrowUpFromLine, keywords: ["allocate"] },
  { title: "New task", href: "/tasks/all?new=1", icon: ListTodo, keywords: ["create", "todo"] },
  { title: "New invoice", href: "/finance/invoices?new=1", icon: FileText, keywords: ["bill customer", "receivable"] },
  { title: "Upload bank statement", href: "/finance/bank-statements", icon: Landmark, keywords: ["deposit", "withdrawal", "reconcile"] },
  { title: "Add fixed asset", href: "/finance/assets/fixed?new=1", icon: Armchair, keywords: ["furniture", "machine", "laptop", "vehicle"] },
  { title: "Add loan", href: "/finance/liabilities/loans?new=1", icon: Banknote, keywords: ["borrowing", "liability"] },
  { title: "Record capital", href: "/finance/equity/owners?new=1", icon: Landmark, keywords: ["owner", "investor", "investment"] },
  { title: "Record wastage", href: "/inventory/wastage", icon: Trash2, keywords: ["damaged", "expired", "lost"] },
  { title: "New what-if scenario", href: "/analytics/scenarios/new", icon: FlaskConical, keywords: ["simulate", "plan"] },
];

const matches = (href: string, exact: boolean | undefined, pathname: string) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/**
 * The module, the sidebar entry and the page (a child, when the entry has
 * children) that a path belongs to, by the deepest matching href. A child's
 * detail pages count as that child: /finance/employees/<id> is Employees under
 * Projects. `item` is always a sidebar entry.
 */
export function findActive(pathname: string): { module: NavModule | null; item: NavItem | null; child: NavItem | null } {
  for (const mod of MODULES) {
    if (pathname !== mod.href && !pathname.startsWith(`${mod.href}/`)) continue;
    let best: { item: NavItem; child: NavItem | null; length: number } | null = null;
    for (const item of mod.items) {
      // Children first, so a child that shares its parent's href wins the tie.
      for (const child of item.children ?? []) {
        if (matches(child.href, child.exact, pathname) && (!best || child.href.length > best.length)) {
          best = { item, child, length: child.href.length };
        }
      }
      if (matches(item.href, item.exact, pathname) && (!best || item.href.length > best.length)) {
        best = { item, child: null, length: item.href.length };
      }
    }
    return { module: mod, item: best?.item ?? null, child: best?.child ?? null };
  }
  return { module: null, item: null, child: null };
}

/** True when the path is the entry's page, one of its children, or a detail page under either. */
export function isItemActive(item: NavItem, pathname: string): boolean {
  return matches(item.href, item.exact, pathname) || (item.children ?? []).some((c) => isItemActive(c, pathname));
}

/**
 * Every page of a module once, in sidebar order: an entry with children
 * stands for its children. A child that shares its entry's href also answers
 * to the entry's name ("Stock in/out" finds Purchase stock). For the command palette.
 */
export function modulePages(mod: NavModule): NavItem[] {
  const seen = new Set<string>();
  const pages: NavItem[] = [];
  for (const item of mod.items) {
    const children = (item.children ?? []).map((c) =>
      c.href === item.href ? { ...c, keywords: [...(c.keywords ?? []), item.title, ...(item.keywords ?? [])] } : c,
    );
    const own = children.length ? [...(children.some((c) => c.href === item.href) ? [] : [item]), ...children] : [item];
    for (const page of own) {
      if (seen.has(page.href)) continue;
      seen.add(page.href);
      pages.push(page);
    }
  }
  return pages;
}

/**
 * The tabs to show above a page: the children of its sidebar entry, with the
 * one the page belongs to marked. Only on the child pages themselves; detail
 * pages (a project, an employee, an item) have their own header and tabs.
 */
export function getSectionTabs(pathname: string): { item: NavItem; tabs: NavItem[]; activeHref: string } | null {
  const { item, child } = findActive(pathname);
  if (!item?.children?.length || !child || pathname !== child.href) return null;
  return { item, tabs: item.children, activeHref: child.href };
}
