import {
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
  type LucideIcon,
} from "lucide-react";

/**
 * The single source of truth for navigation: the sidebar, breadcrumbs and the
 * command palette all read this. A future module (HR, CRM, Payroll …) is one
 * more entry in MODULES.
 */

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Extra words the command palette matches on. */
  keywords?: string[];
  /** Match only the exact path (for module dashboards). */
  exact?: boolean;
};

export type NavModule = {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Module root, also its dashboard. */
  href: string;
  items: NavItem[];
};

export const MODULES: NavModule[] = [
  {
    id: "finance",
    title: "Finance",
    icon: Wallet,
    href: "/finance",
    items: [
      { title: "Dashboard", href: "/finance", icon: LayoutDashboard, exact: true, keywords: ["overview", "profit"] },
      { title: "Expenses", href: "/finance/expenses", icon: Receipt, keywords: ["bills", "spend", "gst", "vendor"] },
      { title: "Recurring", href: "/finance/recurring", icon: Repeat, keywords: ["salary", "salaries", "rent", "bills", "subscriptions", "monthly"] },
      { title: "Income", href: "/finance/income", icon: BadgeIndianRupee, keywords: ["revenue", "payments", "client"] },
      { title: "Projects", href: "/finance/projects", icon: FolderKanban, keywords: ["budget", "client"] },
      { title: "Employees", href: "/finance/employees", icon: Users, keywords: ["staff", "people", "team", "payroll", "salary"] },
      { title: "Reports", href: "/finance/reports", icon: FileBarChart, keywords: ["gst", "ca", "export", "pdf", "excel"] },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    icon: Boxes,
    href: "/inventory",
    items: [
      { title: "Dashboard", href: "/inventory", icon: LayoutDashboard, exact: true, keywords: ["stock overview"] },
      { title: "All Inventory", href: "/inventory/items", icon: Boxes, keywords: ["items", "sku", "stock"] },
      { title: "Categories", href: "/inventory/categories", icon: Tags },
      { title: "Purchase Stock", href: "/inventory/purchase", icon: PackagePlus, keywords: ["buy", "restock"] },
      { title: "Assign to Project", href: "/inventory/assign", icon: ArrowUpFromLine, keywords: ["allocate", "issue"] },
      { title: "Return from Project", href: "/inventory/return", icon: ArrowDownToLine, keywords: ["give back"] },
      { title: "Stock Movement", href: "/inventory/movements", icon: ArrowLeftRight, keywords: ["history", "ledger"] },
      { title: "Low Stock", href: "/inventory/low-stock", icon: TriangleAlert, keywords: ["reorder", "out of stock"] },
      { title: "Reports", href: "/inventory/reports", icon: FileBarChart, keywords: ["valuation"] },
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: ListTodo,
    href: "/tasks",
    items: [
      { title: "Dashboard", href: "/tasks", icon: LayoutDashboard, exact: true },
      { title: "All Tasks", href: "/tasks/all", icon: ClipboardList, keywords: ["kanban", "board"] },
      { title: "My Tasks", href: "/tasks/mine", icon: UserRound, keywords: ["assigned to me"] },
      { title: "Pending", href: "/tasks/status/pending", icon: CircleDashed },
      { title: "In Progress", href: "/tasks/status/in_progress", icon: Loader },
      { title: "Review", href: "/tasks/status/review", icon: Eye },
      { title: "Completed", href: "/tasks/status/completed", icon: CircleCheckBig },
      { title: "Overdue", href: "/tasks/status/overdue", icon: AlarmClock },
      { title: "Cancelled", href: "/tasks/status/cancelled", icon: CircleSlash },
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
];

export function findActive(pathname: string): { module: NavModule | null; item: NavItem | null } {
  for (const mod of MODULES) {
    if (pathname !== mod.href && !pathname.startsWith(`${mod.href}/`)) continue;
    const item =
      [...mod.items]
        .sort((a, b) => b.href.length - a.href.length)
        .find((i) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`))) ?? null;
    return { module: mod, item };
  }
  return { module: null, item: null };
}

export function isItemActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
