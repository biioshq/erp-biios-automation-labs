import {
  Upload,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BadgeIndianRupee,
  Boxes,
  CalendarCheck,
  CalendarDays,
  CalendarX,
  CircleCheckBig,
  CircleDashed,
  CircleSlash,
  ClipboardList,
  Eye,
  FileBarChart,
  FolderKanban,
  LayoutDashboard,
  Lock,
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
  IdCard,
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
  Settings2,
  ShieldCheck,
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
 * command palette all read this. A future module (CRM …) is one more entry
 * in MODULES.
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
   * The permission that shows this entry: its view permission ("finance.expenses:view"), or for a
   * quick action the create permission. The page itself checks it on the server too. An entry
   * with children shows when any child shows.
   */
  permission?: string;
  /** Shows the entry when the person holds any one of these (overrides `permission`). */
  anyPermission?: string[];
  /**
   * Pages that sit under this entry. The sidebar lists only the parent; the
   * children show as tabs at the top of each of these pages. The first child
   * usually shares the parent's href.
   */
  children?: NavItem[];
  /**
   * Pages reached only from inside this page (Fixed assets › Depreciation on assets). They never show
   * in the sidebar: they show as a second row of tabs on this page and on each of them. The first
   * usually shares this page's href.
   */
  pages?: NavItem[];
  /** Not the page people land on after signing in, even when it is first (Bank statements leads Finance; the dashboard stays home). */
  notLanding?: boolean;
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
      {
        title: "Bank statements",
        href: "/finance/bank-statements",
        permission: "finance.bank_statements:view",
        icon: Landmark,
        notLanding: true,
        keywords: ["bank statement", "upload statement", "import statement", "csv", "excel", "pdf", "deposit", "withdrawal", "reconcile", "bank import"],
      },
      { title: "Dashboard", href: "/finance", permission: "finance.dashboard:view", icon: LayoutDashboard, exact: true, keywords: ["overview", "profit", "cash position"] },
      { title: "Daily overview", href: "/finance/daily", permission: "finance.daily:view", icon: CalendarDays, keywords: ["daily", "today", "day book", "cash flow", "income received", "payments made", "outstanding"] },
      {
        title: "Income",
        href: "/finance/income",
        permission: "finance.income:view",
        icon: BadgeIndianRupee,
        keywords: ["revenue", "payments", "client"],
        children: [
          { title: "Income records", tab: "Income", href: "/finance/income", permission: "finance.income:view", icon: BadgeIndianRupee, keywords: ["revenue", "payments", "client"] },
          { title: "Invoices & receivables", tab: "Invoices", href: "/finance/invoices", permission: "finance.invoices:view", icon: FileText, keywords: ["invoice", "receivable", "outstanding", "customer", "billing"] },
          { title: "Income summary", tab: "Summary", href: "/finance/income/summary", permission: "finance.income:view", icon: ChartColumn, keywords: ["daily", "monthly", "yearly", "customer-wise", "project-wise"] },
        ],
      },
      {
        title: "Expenses",
        href: "/finance/expenses",
        permission: "finance.expenses:view",
        icon: Receipt,
        keywords: ["bills", "spend", "gst", "vendor"],
        children: [
          { title: "Total expenses", tab: "Total expenses", href: "/finance/expenses", permission: "finance.expenses:view", icon: Receipt, keywords: ["bills", "spend", "gst", "vendor", "direct", "indirect", "expense records", "paid"] },
          { title: "Outstanding payments", tab: "Outstanding", href: "/finance/payments", permission: "finance.payments:view", icon: CalendarClock, keywords: ["unpaid", "partly paid", "overdue", "upcoming", "due", "mark as paid", "payment tracking"] },
          {
            title: "Recurring expenses",
            tab: "Recurring",
            href: "/finance/recurring",
            permission: "finance.recurring:view",
            icon: Repeat,
            keywords: ["salary", "salaries", "rent", "bills", "subscriptions", "monthly", "weekly", "yearly", "emi", "loan instalment"],
          },
          {
            title: "Fixed payments",
            tab: "Fixed payments",
            href: "/finance/expenses/fixed",
            permission: "finance.expenses:view",
            icon: Lock,
            keywords: ["one-off", "purchase", "goods", "materials", "equipment", "asset", "fixed"],
          },
          { title: "Import", href: "/finance/import", permission: "finance.import:view", icon: Upload, keywords: ["csv", "bulk", "google drive", "bills", "receipts", "income"] },
          { title: "Expense summary", tab: "Summary", href: "/finance/expenses/summary", permission: "finance.expenses:view", icon: ChartColumn, keywords: ["category-wise", "vendor-wise", "monthly", "paid vs unpaid"] },
        ],
      },
      {
        title: "Projects",
        href: "/finance/projects",
        permission: "finance.projects:view",
        icon: FolderKanban,
        keywords: ["budget", "client"],
        children: [
          { title: "Projects", href: "/finance/projects", permission: "finance.projects:view", icon: FolderKanban, keywords: ["budget", "client"] },
          { title: "Profitability", href: "/finance/projects/profitability", permission: "finance.project_finance:view", icon: TrendingUp, keywords: ["profit", "margin", "project income", "project expenses"] },
          { title: "Budget tracking", tab: "Budgets", href: "/finance/projects/budgets", permission: "finance.project_finance:view", icon: Gauge, keywords: ["budget vs actual", "overrun", "variance"] },
          { title: "Employees", href: "/finance/employees", permission: "finance.employees:view", icon: Users, keywords: ["staff", "people", "team", "payroll", "salary"] },
        ],
      },
      {
        title: "Assets",
        href: "/finance/assets",
        permission: "finance.assets_overview:view",
        icon: Building2,
        keywords: ["balance sheet", "what we own"],
        children: [
          { title: "Assets overview", tab: "Overview", href: "/finance/assets", permission: "finance.assets_overview:view", icon: Building2, exact: true, keywords: ["total assets"] },
          { title: "Cash & bank", href: "/finance/assets/cash", permission: "finance.cash_bank:view", icon: Landmark, keywords: ["bank balance", "cash in hand", "accounts", "opening balance"] },
          { title: "Receivables", href: "/finance/assets/receivables", permission: "finance.receivables:view", icon: HandCoins, keywords: ["accounts receivable", "customers owe"] },
          { title: "Prepaid expenses", tab: "Prepaid", href: "/finance/assets/prepaid", permission: "finance.prepaid:view", icon: CalendarRange, keywords: ["advance paid", "insurance", "annual"] },
          { title: "Inventory valuation", tab: "Inventory", href: "/finance/assets/inventory", permission: "finance.inventory_valuation:view", icon: Boxes, keywords: ["stock in storage", "stock in use", "wasted stock"] },
          {
            title: "Fixed assets",
            href: "/finance/assets/fixed",
            permission: "finance.fixed_assets:view",
            icon: Armchair,
            keywords: ["furniture", "machinery", "vehicles", "computers", "register"],
            pages: [
              { title: "Fixed asset register", tab: "Asset register", href: "/finance/assets/fixed", permission: "finance.fixed_assets:view", icon: Armchair },
              { title: "Depreciation on assets", tab: "Depreciation on assets", href: "/finance/assets/fixed/depreciation", permission: "finance.fixed_assets:view", icon: TrendingDown, keywords: ["depreciation", "book value", "accumulated depreciation"] },
            ],
          },
          {
            title: "Intangible assets",
            tab: "Intangible",
            href: "/finance/assets/intangible",
            permission: "finance.fixed_assets:view",
            icon: KeyRound,
            keywords: ["software", "licences", "intangible"],
            pages: [
              { title: "Intangible asset register", tab: "Asset register", href: "/finance/assets/intangible", permission: "finance.fixed_assets:view", icon: KeyRound },
              { title: "Amortization", tab: "Amortization", href: "/finance/assets/intangible/amortization", permission: "finance.fixed_assets:view", icon: TrendingDown, keywords: ["amortisation", "amortization", "carrying value"] },
            ],
          },
          { title: "Investments", href: "/finance/assets/investments", permission: "finance.investments:view", icon: PiggyBank, keywords: ["fixed deposit", "mutual fund", "shares"] },
        ],
      },
      {
        title: "Liabilities",
        href: "/finance/liabilities",
        permission: "finance.liabilities:view",
        icon: Scale,
        keywords: ["owe", "debt", "balance sheet"],
        children: [
          { title: "Liabilities overview", tab: "Overview", href: "/finance/liabilities", permission: "finance.liabilities:view", icon: Scale, exact: true, keywords: ["total liabilities", "overdue"] },
          { title: "Accounts payable", tab: "Payables", href: "/finance/liabilities/payables", permission: "finance.liabilities:view", icon: Receipt, keywords: ["vendor dues", "unpaid bills", "suppliers"] },
          { title: "Loans & borrowings", tab: "Loans", href: "/finance/liabilities/loans", permission: "finance.liabilities:view", icon: Banknote, keywords: ["loan", "emi", "interest", "lender"] },
          { title: "Current liabilities", tab: "Current", href: "/finance/liabilities/current", permission: "finance.liabilities:view", icon: ListChecks, keywords: ["short-term", "taxes payable", "salaries payable", "customer advances"] },
          { title: "Non-current liabilities", tab: "Non-current", href: "/finance/liabilities/non-current", permission: "finance.liabilities:view", icon: ListTree, keywords: ["long-term", "term loan"] },
        ],
      },
      {
        title: "Capital / Equity",
        href: "/finance/equity",
        permission: "finance.equity:view",
        icon: Landmark,
        keywords: ["owner", "investor", "capital", "shareholders"],
        children: [
          { title: "Equity summary", tab: "Summary", href: "/finance/equity", permission: "finance.equity:view", icon: Landmark, exact: true, keywords: ["total equity"] },
          { title: "Owners' capital", tab: "Owners", href: "/finance/equity/owners", permission: "finance.equity:view", icon: UserRound, keywords: ["owner", "promoter", "capital introduced"] },
          { title: "Investors' capital", tab: "Investors", href: "/finance/equity/investors", permission: "finance.equity:view", icon: Users, keywords: ["investor", "shareholding", "ownership"] },
          { title: "Drawings", href: "/finance/equity/drawings", permission: "finance.equity:view", icon: ArrowUpFromLine, keywords: ["withdrawal", "owner drawings"] },
          { title: "Retained earnings", tab: "Retained", href: "/finance/equity/retained-earnings", permission: "finance.equity:view", icon: TrendingUp, keywords: ["accumulated profit", "dividends"] },
          { title: "Reserves & surplus", tab: "Reserves", href: "/finance/equity/reserves", permission: "finance.equity:view", icon: Vault, keywords: ["general reserve"] },
        ],
      },
      {
        title: "Reports",
        href: "/finance/reports",
        permission: "finance.reports:view",
        icon: FileBarChart,
        keywords: ["gst", "ca", "export", "pdf", "excel", "inventory", "stock valuation"],
        children: [
          { title: "Reports", tab: "All reports", href: "/finance/reports", permission: "finance.reports:view", icon: FileBarChart, keywords: ["gst", "ca", "export", "pdf", "excel", "inventory", "stock valuation"] },
          { title: "Balance sheet", href: "/finance/reports/balance-sheet", permission: "finance.statements:view", icon: Scale, keywords: ["assets", "liabilities", "equity", "position"] },
          { title: "Profit & loss", href: "/finance/reports/profit-loss", permission: "finance.statements:view", icon: TrendingUp, keywords: ["p&l", "income statement", "net profit"] },
          { title: "Cash flow", href: "/finance/reports/cash-flow", permission: "finance.statements:view", icon: ArrowLeftRight, keywords: ["cash inflow", "cash outflow"] },
          { title: "Trial balance", href: "/finance/reports/trial-balance", permission: "finance.statements:view", icon: ListChecks, keywords: ["ledger", "debit", "credit"] },
        ],
      },
      { title: "Audit trail", href: "/finance/audit", permission: "finance.audit:view", icon: History, keywords: ["audit", "history", "log", "who changed", "edited", "imported", "deleted"] },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    icon: Boxes,
    href: "/inventory",
    items: [
      { title: "Dashboard", href: "/inventory", permission: "inventory.dashboard:view", icon: LayoutDashboard, exact: true, keywords: ["stock overview"] },
      {
        title: "Items",
        href: "/inventory/items",
        permission: "inventory.items:view",
        icon: Boxes,
        keywords: ["all inventory", "sku", "stock"],
        children: [
          { title: "All items", href: "/inventory/items", permission: "inventory.items:view", icon: Boxes, keywords: ["all inventory", "sku", "stock"] },
          { title: "Categories", href: "/inventory/categories", permission: "inventory.categories:view", icon: Tags, keywords: ["item categories"] },
          { title: "Low stock", href: "/inventory/low-stock", permission: "inventory.low_stock:view", icon: TriangleAlert, keywords: ["reorder", "out of stock"] },
          { title: "Import items", tab: "Import", href: "/inventory/import", permission: "inventory.import:view", icon: Upload, keywords: ["csv", "bulk", "google drive", "photos"] },
        ],
      },
      {
        title: "Stock in/out",
        href: "/inventory/purchase",
        permission: "inventory.purchase:view",
        icon: PackagePlus,
        keywords: ["purchase", "assign", "return", "stock in", "stock out", "transfer", "wastage"],
        children: [
          { title: "Purchase stock", tab: "Purchase", href: "/inventory/purchase", permission: "inventory.purchase:view", icon: PackagePlus, keywords: ["buy", "restock", "stock in"] },
          { title: "Assign to project", href: "/inventory/assign", permission: "inventory.movement:view", icon: ArrowUpFromLine, keywords: ["allocate", "issue", "stock out"] },
          { title: "Return from project", href: "/inventory/return", permission: "inventory.movement:view", icon: ArrowDownToLine, keywords: ["give back", "stock in"] },
          { title: "Stock transfer", tab: "Transfer", href: "/inventory/transfer", permission: "inventory.movement:view", icon: ArrowLeftRight, keywords: ["move stock", "project to project", "location"] },
          { title: "Record wastage", tab: "Wastage", href: "/inventory/wastage", permission: "inventory.wastage:view", icon: Trash2, keywords: ["damaged", "expired", "lost", "write off"] },
        ],
      },
      { title: "Movements", href: "/inventory/movements", permission: "inventory.movements:view", icon: ArrowLeftRight, keywords: ["stock movement", "history", "ledger"] },
    ],
  },
  {
    id: "analytics",
    title: "Analytics & Planning",
    icon: ChartNoAxesCombined,
    href: "/analytics",
    items: [
      { title: "Dashboard", href: "/analytics", permission: "analytics.dashboard:view", icon: LayoutDashboard, exact: true, keywords: ["insights", "risks", "decision support"] },
      {
        title: "What-if scenarios",
        href: "/analytics/scenarios",
        permission: "analytics.scenarios:view",
        icon: FlaskConical,
        keywords: ["what if", "simulate", "scenario planning"],
        children: [
          { title: "All scenarios", tab: "Scenarios", href: "/analytics/scenarios", permission: "analytics.scenarios:view", icon: FlaskConical, keywords: ["saved scenarios", "drafts"] },
          { title: "New scenario", tab: "New", href: "/analytics/scenarios/new", permission: "analytics.scenarios:create", icon: Plus, keywords: ["demand change", "supply delay", "new project", "price change", "budget", "manpower", "equipment"] },
        ],
      },
      {
        title: "Forecasting",
        href: "/analytics/forecasting",
        permission: "analytics.forecasting:view",
        icon: LineChart,
        keywords: ["predict", "forecast"],
        children: [
          { title: "Inventory demand", tab: "Demand", href: "/analytics/forecasting", permission: "analytics.forecasting:view", icon: Boxes, keywords: ["stockout", "coverage"] },
          { title: "Purchase requirements", tab: "Purchases", href: "/analytics/forecasting/purchases", permission: "analytics.forecasting:view", icon: PackagePlus, keywords: ["reorder", "suggested purchase"] },
          { title: "Project cost forecast", tab: "Project cost", href: "/analytics/forecasting/projects", permission: "analytics.forecasting:view", icon: FolderKanban, keywords: ["final cost", "overrun"] },
          { title: "Material consumption", tab: "Consumption", href: "/analytics/forecasting/consumption", permission: "analytics.forecasting:view", icon: Activity, keywords: ["daily", "weekly", "monthly use"] },
          { title: "Equipment maintenance", tab: "Maintenance", href: "/analytics/forecasting/maintenance", permission: "analytics.forecasting:view", icon: Wrench, keywords: ["service due"] },
          { title: "Manpower requirement", tab: "Manpower", href: "/analytics/forecasting/manpower", permission: "analytics.forecasting:view", icon: Users, keywords: ["staffing", "hiring"] },
          { title: "Forecast vs actual", tab: "Accuracy", href: "/analytics/forecasting/accuracy", permission: "analytics.forecasting:view", icon: Target, keywords: ["accuracy", "deviation"] },
        ],
      },
      {
        title: "Comparison",
        href: "/analytics/compare",
        permission: "analytics.compare:view",
        icon: Columns3,
        keywords: ["scenario comparison", "compare scenarios", "side by side"],
        children: [
          { title: "Compare scenarios", tab: "Compare", href: "/analytics/compare", permission: "analytics.compare:view", icon: Columns3, keywords: ["side by side"] },
          { title: "Scenario history", tab: "History", href: "/analytics/compare/history", permission: "analytics.compare:view", icon: History, keywords: ["changes", "approvals"] },
        ],
      },
      {
        title: "Stock analytics",
        href: "/analytics/inventory",
        permission: "analytics.inventory:view",
        icon: Boxes,
        keywords: ["inventory analytics", "stock analytics"],
        children: [
          { title: "Stock movement analysis", tab: "Movement", href: "/analytics/inventory", permission: "analytics.inventory:view", icon: ArrowLeftRight, keywords: ["received", "issued", "trends"] },
          { title: "Fast and slow moving", tab: "Fast / slow", href: "/analytics/inventory/velocity", permission: "analytics.inventory:view", icon: Gauge, keywords: ["non-moving", "frequently used"] },
          { title: "Inventory ageing", tab: "Ageing", href: "/analytics/inventory/ageing", permission: "analytics.inventory:view", icon: Hourglass, keywords: ["0-30 days", "old stock"] },
          { title: "Overstock and understock", tab: "Levels", href: "/analytics/inventory/levels", permission: "analytics.inventory:view", icon: TriangleAlert, keywords: ["excess", "below minimum"] },
          { title: "Consumption trends", tab: "Consumption", href: "/analytics/inventory/consumption", permission: "analytics.inventory:view", icon: Activity, keywords: ["usage trend"] },
          { title: "Shortage risk", tab: "Shortage risk", href: "/analytics/inventory/shortages", permission: "analytics.inventory:view", icon: CircleAlert, keywords: ["stockout risk"] },
        ],
      },
      {
        title: "Project analytics",
        href: "/analytics/projects",
        permission: "analytics.projects:view",
        icon: FolderKanban,
        keywords: ["project and cost analytics", "cost analytics"],
        children: [
          { title: "Project cost analysis", tab: "Cost", href: "/analytics/projects", permission: "analytics.projects:view", icon: IndianRupee, keywords: ["material cost", "labour cost"] },
          { title: "Budget vs actual", tab: "Budget vs actual", href: "/analytics/projects/budget", permission: "analytics.projects:view", icon: Gauge, keywords: ["variance"] },
          { title: "Resource utilisation", tab: "Resources", href: "/analytics/projects/resources", permission: "analytics.projects:view", icon: Users, keywords: ["materials", "equipment", "manpower"] },
          { title: "Cost overruns", tab: "Overruns", href: "/analytics/projects/overruns", permission: "analytics.projects:view", icon: TriangleAlert, keywords: ["over budget"] },
          { title: "Project performance", tab: "Performance", href: "/analytics/projects/performance", permission: "analytics.projects:view", icon: Target, keywords: ["progress", "delays"] },
        ],
      },
      {
        title: "Insights",
        href: "/analytics/insights",
        permission: "analytics.insights:view",
        icon: Lightbulb,
        keywords: ["management insights", "management reports"],
        children: [
          { title: "Business performance", tab: "Overall", href: "/analytics/insights", permission: "analytics.insights:view", icon: Briefcase, keywords: ["overview"] },
          { title: "Financial performance", tab: "Financial", href: "/analytics/insights/financial", permission: "analytics.insights:view", icon: TrendingUp, keywords: ["revenue trend", "cash flow"] },
          { title: "Procurement analysis", tab: "Procurement", href: "/analytics/insights/procurement", permission: "analytics.insights:view", icon: PackagePlus, keywords: ["purchase value", "price trend"] },
          { title: "Vendor performance", tab: "Vendors", href: "/analytics/insights/vendors", permission: "analytics.insights:view", icon: Store, keywords: ["supplier"] },
          { title: "Operational efficiency", tab: "Efficiency", href: "/analytics/insights/efficiency", permission: "analytics.insights:view", icon: Activity, keywords: ["utilisation", "wastage"] },
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
      { title: "Dashboard", href: "/tasks", permission: "tasks.tasks:view", icon: LayoutDashboard, exact: true },
      {
        title: "All tasks",
        href: "/tasks/all",
        permission: "tasks.tasks:view",
        icon: ClipboardList,
        keywords: ["kanban", "board"],
        children: [
          { title: "All tasks", tab: "All", href: "/tasks/all", permission: "tasks.tasks:view", icon: ClipboardList, keywords: ["kanban", "board"] },
          { title: "Pending tasks", tab: "Pending", href: "/tasks/status/pending", permission: "tasks.tasks:view", icon: CircleDashed, keywords: ["not started"] },
          { title: "In progress tasks", tab: "In progress", href: "/tasks/status/in_progress", permission: "tasks.tasks:view", icon: Loader, keywords: ["working on"] },
          { title: "Review tasks", tab: "Review", href: "/tasks/status/review", permission: "tasks.tasks:view", icon: Eye, keywords: ["waiting for check"] },
          { title: "Completed tasks", tab: "Completed", href: "/tasks/status/completed", permission: "tasks.tasks:view", icon: CircleCheckBig, keywords: ["done", "finished"] },
          { title: "Overdue tasks", tab: "Overdue", href: "/tasks/status/overdue", permission: "tasks.tasks:view", icon: AlarmClock, keywords: ["late", "past due"] },
          { title: "Cancelled tasks", tab: "Cancelled", href: "/tasks/status/cancelled", permission: "tasks.tasks:view", icon: CircleSlash, keywords: ["dropped"] },
        ],
      },
      { title: "My tasks", href: "/tasks/mine", permission: "tasks.tasks:view", icon: UserRound, keywords: ["assigned to me"] },
      { title: "Calendar", href: "/tasks/calendar", permission: "tasks.tasks:view", icon: CalendarDays, keywords: ["schedule", "due dates"] },
    ],
  },
  {
    // Last in the list, so nobody's start page moves: it is the first module a role opens.
    id: "hr",
    title: "HR",
    icon: IdCard,
    href: "/hr",
    items: [
      {
        title: "Attendance",
        href: "/hr/attendance",
        permission: "hr.attendance:view",
        icon: CalendarCheck,
        keywords: ["hr", "attendance", "present", "absent", "in time", "out time", "leave", "salary"],
        children: [
          { title: "Daily attendance", tab: "Daily", href: "/hr/attendance", permission: "hr.attendance:view", icon: CalendarCheck, keywords: ["mark attendance", "in time", "out time", "present", "absent", "half day", "late"] },
          { title: "Monthly register", tab: "Monthly", href: "/hr/attendance/register", permission: "hr.attendance:view", icon: CalendarDays, keywords: ["muster roll", "attendance register", "month"] },
          { title: "Leaves", href: "/hr/attendance/leaves", permission: "hr.leaves:view", icon: CalendarX, keywords: ["leave", "casual leave", "sick leave", "leave balance", "time off"] },
          { title: "Salary from attendance", tab: "Salary", href: "/hr/attendance/salary", permission: "hr.salary:view", icon: IndianRupee, keywords: ["payroll", "salary", "loss of pay", "lop", "overtime", "payable days"] },
          { title: "Attendance rules", tab: "Rules", href: "/hr/attendance/rules", permission: "hr.settings:view", icon: Settings2, keywords: ["office hours", "holidays", "weekly off", "leave types", "late", "overtime"] },
        ],
      },
    ],
  },
];

/**
 * Settings pages. They are not a sidebar module: the user menu and the command palette link them,
 * and the breadcrumbs show "Settings".
 */
export const SETTINGS_PAGES: NavItem[] = [
  { title: "Team members", href: "/settings/team", permission: "settings.team:view", icon: Users, keywords: ["people", "staff", "password", "role", "invite"] },
  { title: "Roles and permissions", href: "/settings/roles", permission: "settings.roles:view", icon: ShieldCheck, keywords: ["access", "who can see", "rights", "admin", "member"] },
  { title: "Business details", href: "/settings/company", permission: "settings.company:view", icon: Building2, keywords: ["company", "gstin", "pan", "address", "bank details", "upi", "invoice terms", "logo", "signatory"] },
];

/** Quick actions for the command palette. `?new=1` opens the page's create drawer. */
export const QUICK_ACTIONS: NavItem[] = [
  { title: "Add expense", href: "/finance/expenses?new=1", permission: "finance.expenses:create", icon: Receipt, keywords: ["new", "create", "bill", "receipt", "ocr"] },
  { title: "Add recurring expense", href: "/finance/recurring?new=1", permission: "finance.recurring:create", icon: Repeat, keywords: ["salary", "rent", "bill", "subscription"] },
  { title: "Record income", href: "/finance/income?new=1", permission: "finance.income:create", icon: BadgeIndianRupee, keywords: ["new", "payment received"] },
  { title: "Add employee", href: "/finance/employees?new=1", permission: "finance.employees:create", icon: Users, keywords: ["staff", "hire", "people"] },
  { title: "New project", href: "/finance/projects?new=1", permission: "finance.projects:create", icon: FolderKanban, keywords: ["create"] },
  { title: "Add inventory item", href: "/inventory/items?new=1", permission: "inventory.items:create", icon: Boxes, keywords: ["new", "sku"] },
  { title: "Purchase stock", href: "/inventory/purchase", permission: "inventory.purchase:create", icon: PackagePlus, keywords: ["buy"] },
  { title: "Assign stock to a project", href: "/inventory/assign", permission: "inventory.movement:create", icon: ArrowUpFromLine, keywords: ["allocate"] },
  { title: "New task", href: "/tasks/all?new=1", permission: "tasks.tasks:create", icon: ListTodo, keywords: ["create", "todo"] },
  { title: "New invoice", href: "/finance/invoices?new=1", permission: "finance.invoices:create", icon: FileText, keywords: ["bill customer", "receivable"] },
  { title: "Upload bank statement", href: "/finance/bank-statements", permission: "finance.bank_statements:create", icon: Landmark, keywords: ["deposit", "withdrawal", "reconcile"] },
  { title: "Add fixed asset", href: "/finance/assets/fixed?new=1", permission: "finance.fixed_assets:create", icon: Armchair, keywords: ["furniture", "machine", "laptop", "vehicle"] },
  { title: "Add loan", href: "/finance/liabilities/loans?new=1", permission: "finance.liabilities:create", icon: Banknote, keywords: ["borrowing", "liability"] },
  { title: "Record capital", href: "/finance/equity/owners?new=1", permission: "finance.equity:create", icon: Landmark, keywords: ["owner", "investor", "investment"] },
  { title: "Record wastage", href: "/inventory/wastage", permission: "inventory.wastage:create", icon: Trash2, keywords: ["damaged", "expired", "lost"] },
  { title: "New what-if scenario", href: "/analytics/scenarios/new", permission: "analytics.scenarios:create", icon: FlaskConical, keywords: ["simulate", "plan"] },
  { title: "Mark attendance", href: "/hr/attendance", permission: "hr.attendance:create", icon: CalendarCheck, keywords: ["present", "absent", "in time", "out time", "hr"] },
  { title: "Record leave", href: "/hr/attendance/leaves?new=1", permission: "hr.leaves:create", icon: CalendarX, keywords: ["leave", "time off", "hr"] },
];

const matches = (href: string, exact: boolean | undefined, pathname: string) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

/**
 * The module, the sidebar entry and the page (a child, when the entry has
 * children) that a path belongs to, by the deepest matching href. A child's
 * detail pages count as that child: /finance/employees/<id> is Employees under
 * Projects. `item` is always a sidebar entry. `page` is the sub-page of the child (or of the entry,
 * when it has no children) the path is on, when that entry has sub-pages (Fixed assets ›
 * Depreciation on assets).
 */
export function findActive(pathname: string): { module: NavModule | null; item: NavItem | null; child: NavItem | null; page: NavItem | null } {
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
    const owner = best?.child ?? best?.item ?? null;
    const page = (owner?.pages ?? []).reduce<NavItem | null>((found, p) => (matches(p.href, p.exact, pathname) && (!found || p.href.length > found.href.length) ? p : found), null);
    return { module: mod, item: best?.item ?? null, child: best?.child ?? null, page };
  }
  return { module: null, item: null, child: null, page: null };
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
    const top = children.length ? [...(children.some((c) => c.href === item.href) ? [] : [item]), ...children] : [item];
    // Sub-pages are found by search too, under the page they sit in (Fixed assets › Depreciation on assets).
    const own = top.flatMap((p) => [p, ...(p.pages ?? []).map((s) => ({ ...s, keywords: [...(s.keywords ?? []), p.title] }))]);
    for (const page of own) {
      if (seen.has(page.href)) continue;
      seen.add(page.href);
      pages.push(page);
    }
  }
  return pages;
}

/** Answers whether the person holds a permission (useCan on the client, can(user, p) on the server). */
export type CanFn = (permission: string) => boolean;

/** True when the person may open this page (entries without a permission show to everyone). */
export function canOpen(item: NavItem, can: CanFn): boolean {
  if (item.anyPermission?.length) return item.anyPermission.some((p) => can(p));
  return !item.permission || can(item.permission);
}

/**
 * The tabs to show above a page: the children of its sidebar entry the person may open, with the
 * one the page belongs to marked. Only on the child pages themselves; detail pages (a project, an
 * employee, an item) have their own header and tabs.
 */
export function getSectionTabs(
  pathname: string,
  can: CanFn,
): { item: NavItem; tabs: NavItem[]; activeHref: string; subTabs: NavItem[]; activeSubHref: string | null } | null {
  const { item, child, page } = findActive(pathname);
  const owner = child ?? item;
  // Sub-pages (Fixed assets › Depreciation on assets) show as a second row on the page and on each of them.
  const subTabs = (owner?.pages ?? []).filter((p) => canOpen(p, can));
  const onSubPage = Boolean(page && pathname === page.href);
  if (item?.children?.length && child && (pathname === child.href || onSubPage)) {
    return { item, tabs: item.children.filter((c) => canOpen(c, can)), activeHref: child.href, subTabs, activeSubHref: page?.href ?? null };
  }
  if (item && !item.children?.length && subTabs.length && (pathname === item.href || onSubPage)) {
    return { item, tabs: [], activeHref: item.href, subTabs, activeSubHref: page?.href ?? null };
  }
  return null;
}

/**
 * The entries a person sees. An entry with pages under it shows when at least one of them does,
 * and opens the first one the person may open.
 */
export function visibleItems(items: NavItem[], can: CanFn): NavItem[] {
  return items.flatMap((i) => {
    if (!i.children?.length) return canOpen(i, can) ? [i] : [];
    const children = i.children.filter((c) => canOpen(c, can));
    if (!children.length) return [];
    const ownShown = children.some((c) => c.href === i.href);
    return [{ ...i, children, href: ownShown ? i.href : children[0].href }];
  });
}

/** The modules a person sees: those with at least one entry they may open, each with only those entries. */
export function visibleModules(can: CanFn): NavModule[] {
  return MODULES.flatMap((m) => {
    const items = visibleItems(m.items, can);
    return items.length ? [{ ...m, items }] : [];
  });
}

/** The first page a person may open, in sidebar order, or null when their role opens none. */
export function firstAllowedHref(can: CanFn): string | null {
  const items = visibleModules(can)[0]?.items ?? [];
  return (items.find((i) => !i.notLanding) ?? items[0])?.href ?? null;
}
