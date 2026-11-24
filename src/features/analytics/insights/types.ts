import type { EmployeeLoad, MaintenanceDue, MonthlyStock, ProjectHealth, PurchaseRequirement } from "../dashboard/types";
import type { InsightPeriod } from "./period";
import type { PaymentStatus } from "@/lib/constants";

/** Client-safe shapes for the management insights pages. */

export type OpenItems = { total: number; count: number; overdue: number; overdueCount: number; dueSoon: number };
export type PartyBalance = { name: string; outstanding: number; count: number; overdue: number };

export type BusinessInsights = {
  counts: { total: number; planning: number; active: number; onHold: number; completed: number; cancelled: number; delayed: number };
  value: { total: number; withValue: number; projects: number };
  budget: { total: number; projects: number };
  spent: number;
  companyExpenses: { amount: number; label: string };
  budgetUse: { budget: number; spent: number; usage: number | null; projects: number };
  inventory: { value: number; items: number; lowStock: number; outOfStock: number };
  payables: OpenItems & { salariesLeftOut: boolean };
  topVendors: PartyBalance[];
  requirements: PurchaseRequirement[];
  requirementTotals: { count: number; cost: number; unknownCost: number };
  projects: ProjectHealth[];
  salariesHidden: boolean;
};

export type MonthMoney = { month: string; income: number; expenses: number; profit: number };

export type FinancialInsights = {
  fyLabel: string;
  fy: { income: number; expenses: number };
  monthly: MonthMoney[];
  /** Only with the financial position permission (null otherwise): P&L per month and for the year, from the accounting engine. */
  pl: { months: (MonthMoney & { grossProfit: number })[]; fy: { income: number; expenses: number; profit: number; grossProfit: number; from: string; to: string } } | null;
  /** Only with the financial position permission: cash flow for the financial year to date and balances today. */
  cash: {
    from: string;
    to: string;
    opening: number;
    closing: number;
    netChange: number;
    activities: { key: string; label: string; net: number }[];
    accounts: { code: string; name: string; balance: number }[];
  } | null;
  budget: { rows: { id: string; label: string; budget: number; spent: number; usage: number | null }[]; total: { budget: number; spent: number; usage: number | null; projects: number } };
  receivables: OpenItems;
  topClients: PartyBalance[];
  payables: OpenItems & { salariesLeftOut: boolean };
  topVendors: PartyBalance[];
  salariesHidden: boolean;
};

export type PurchaseMonth = { month: string; stock: number; materials: number; equipment: number };

export type VendorRow = {
  key: string;
  name: string;
  bills: number;
  value: number;
  stock: number;
  first: string;
  last: string;
  outstanding: number;
  items: number;
};

export type MaterialRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  purchases: number;
  qty: number;
  value: number;
  avgPrice: number | null;
  minPrice: number;
  maxPrice: number;
  lastPrice: number;
  vendors: number;
};

export type PricePoint = { date: string; price: number; qty: number; vendor: string; bought: boolean };

export type PriceChange = {
  id: string;
  name: string;
  unit: string;
  purchases: number;
  firstDate: string;
  firstPrice: number;
  lastDate: string;
  lastPrice: number;
  change: number | null;
  lastVendor: string;
};

export type ProcurementInsights = {
  period: InsightPeriod;
  phrase: string;
  totals: { value: number; stock: number; materials: number; equipment: number; bills: number; opening: number; openingEntries: number };
  months: PurchaseMonth[];
  vendors: VendorRow[];
  materials: MaterialRow[];
  priceItems: { value: string; label: string; description: string }[];
  priceItem: { id: string; name: string; unit: string; points: PricePoint[] } | null;
  priceChanges: PriceChange[];
};

export type VendorPrice = { vendor: string; purchases: number; qty: number; avgPrice: number; lastPrice: number; lastDate: string };

export type PriceComparison = { id: string; name: string; unit: string; vendors: VendorPrice[]; spread: number | null };

export type VendorBill = {
  id: string;
  number: string;
  date: string;
  /** Category label. */
  category: string;
  description: string | null;
  amount: number;
  outstanding: number;
  status: PaymentStatus;
};

export type VendorInsights = {
  period: InsightPeriod;
  phrase: string;
  totals: { bills: number; value: number; vendors: number; stockPurchases: number; outstanding: number };
  vendors: VendorRow[];
  comparisons: PriceComparison[];
  selected: {
    key: string;
    name: string;
    row: VendorRow | null;
    bills: VendorBill[];
    purchases: { id: string; item: string; itemId: string; date: string; qty: number; unit: string; price: number; value: number }[];
  } | null;
};

export type EfficiencyInsights = {
  windowLabel: string;
  months: MonthlyStock[];
  materials: { consumed: number; bought: number; opening: number; wasted: number; ratio: number | null };
  items: { id: string; name: string; unit: string; received: number; consumed: number; wasted: number; available: number; ratio: number | null }[];
  equipment: { total: number; onProjects: number; rows: { id: string; code: string; name: string; condition: string; project: { id: string; name: string } | null; until: string | null }[] };
  people: { active: number; average: number | null; over: EmployeeLoad[]; unallocated: number; full: number; employees: EmployeeLoad[]; unstaffed: { id: string; name: string; code: string }[] };
  delays: { projects: ProjectHealth[]; overdueTasks: number; pastEnd: number };
  shortages: { out: number; belowMin: number; runsOut: number };
  maintenance: MaintenanceDue[];
  wastage: { total: number; storage: number; project: number; byReason: { reason: string; label: string; value: number; entries: number }[] };
  overheads: { months: { month: string; amount: number }[]; categories: { value: string; label: string; amount: number }[]; total: number };
  salariesHidden: boolean;
};
