import { Boxes, Calculator, FileBarChart, FolderKanban, Landmark, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
import type { ReportType } from "@/lib/constants";

export type ReportFilterKey = "date" | "project" | "vendor" | "category";

export type ReportMeta = {
  type: ReportType;
  label: string;
  icon: LucideIcon;
  description: string;
  contains: string[];
  /** Filters that change this report. Others are hidden. */
  filters: ReportFilterKey[];
  /** Which category list the category filter uses. */
  categories?: "expense" | "income" | "inventory";
};

export const REPORT_META: ReportMeta[] = [
  {
    type: "finance",
    label: "Finance",
    icon: TrendingUp,
    description: "Profit and loss for the period.",
    contains: ["Income and expenses by category", "Profit and margin", "Month by month table"],
    filters: ["date", "project"],
  },
  {
    type: "expense",
    label: "Expense",
    icon: Receipt,
    description: "Every expense with its GST split.",
    contains: ["Vendor, project, stage, category", "Taxable value, CGST, SGST, IGST, CESS", "GSTIN and invoice number"],
    filters: ["date", "project", "vendor", "category"],
    categories: "expense",
  },
  {
    type: "income",
    label: "Income",
    icon: Landmark,
    description: "Payments received, by client and project.",
    contains: ["Client, project, category", "Payment method and reference", "Totals"],
    filters: ["date", "project", "category"],
    categories: "income",
  },
  {
    type: "gst",
    label: "GST",
    icon: Calculator,
    description: "Input tax credit register for return filing.",
    contains: ["GST on expenses and stock purchases", "Totals by tax head and by GSTIN", "HSN or SAC codes"],
    filters: ["date", "project", "vendor", "category"],
    categories: "expense",
  },
  {
    type: "project",
    label: "Project",
    icon: FolderKanban,
    description: "Budget against spend and income per project.",
    contains: ["Budget, spent, remaining, usage", "Spend across the 7 stages", "Income and profit"],
    filters: ["project"],
  },
  {
    type: "inventory",
    label: "Inventory",
    icon: Boxes,
    description: "Stock valuation or the movement ledger.",
    contains: ["On-hand and allocated value", "Category subtotals and stock status", "Optional movement ledger"],
    filters: ["category"],
    categories: "inventory",
  },
  {
    type: "ca",
    label: "CA pack",
    icon: FileBarChart,
    description: "One pack for your chartered accountant.",
    contains: ["Summary with GST input by head", "Expense, income and GST registers", "Vendor-wise totals"],
    filters: ["date", "project", "vendor", "category"],
    categories: "expense",
  },
];

export const metaOf = (type: string | undefined) => REPORT_META.find((m) => m.type === type);
