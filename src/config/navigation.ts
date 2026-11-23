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
  /** Sidebar entries: five at most per module. */
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
      {
        title: "Expenses",
        href: "/finance/expenses",
        icon: Receipt,
        keywords: ["bills", "spend", "gst", "vendor"],
        children: [
          { title: "Expenses", href: "/finance/expenses", icon: Receipt, keywords: ["bills", "spend", "gst", "vendor"] },
          {
            title: "Recurring expenses",
            tab: "Recurring",
            href: "/finance/recurring",
            icon: Repeat,
            keywords: ["salary", "salaries", "rent", "bills", "subscriptions", "monthly"],
          },
          { title: "Import", href: "/finance/import", icon: Upload, keywords: ["csv", "bulk", "google drive", "bills", "receipts", "income"] },
        ],
      },
      { title: "Income", href: "/finance/income", icon: BadgeIndianRupee, keywords: ["revenue", "payments", "client"] },
      {
        title: "Projects",
        href: "/finance/projects",
        icon: FolderKanban,
        keywords: ["budget", "client"],
        children: [
          { title: "Projects", href: "/finance/projects", icon: FolderKanban, keywords: ["budget", "client"] },
          { title: "Employees", href: "/finance/employees", icon: Users, keywords: ["staff", "people", "team", "payroll", "salary"] },
        ],
      },
      { title: "Reports", href: "/finance/reports", icon: FileBarChart, keywords: ["gst", "ca", "export", "pdf", "excel", "inventory", "stock valuation"] },
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
        keywords: ["purchase", "assign", "return", "stock in", "stock out"],
        children: [
          { title: "Purchase stock", tab: "Purchase", href: "/inventory/purchase", icon: PackagePlus, keywords: ["buy", "restock", "stock in"] },
          { title: "Assign to project", href: "/inventory/assign", icon: ArrowUpFromLine, keywords: ["allocate", "issue", "stock out"] },
          { title: "Return from project", href: "/inventory/return", icon: ArrowDownToLine, keywords: ["give back", "stock in"] },
        ],
      },
      { title: "Movements", href: "/inventory/movements", icon: ArrowLeftRight, keywords: ["stock movement", "history", "ledger"] },
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
