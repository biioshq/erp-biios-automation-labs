import type { FileDTO } from "@/features/files/types";
import type { AssetCondition, AssetFunding, Department, DepreciationMethod, PaymentMethod, PaymentStatus } from "@/lib/constants";
import type { AssetKind } from "./labels";

export type AssetFundingDTO = {
  mode: AssetFunding;
  expense: {
    id: string;
    number: string;
    vendor: string;
    amount: number;
    date: string;
    status: PaymentStatus;
    outstanding: number;
    /** The unpaid bill the asset form created for this asset ("Not paid yet"). */
    createdWithAsset: boolean;
  } | null;
  account: { id: string; name: string } | null;
  paymentMethod: PaymentMethod | null;
};

/** A row of the register. Figures are as of today (IST), computed from src/lib/depreciation.ts. */
export type AssetRow = {
  id: string;
  code: string;
  name: string;
  kind: AssetKind;
  group: string;
  groupLabel: string;
  /** "Fixed assets › Furniture and fixtures › Office chairs" */
  groupPath: string;
  quantity: number;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationMethod: DepreciationMethod;
  wdvRate: number | null;
  /** Charged so far (up to the disposal date for a disposed asset). */
  accumulated: number;
  bookValue: number;
  /** Charged in the current financial year. */
  chargedThisYear: number;
  /** False once disposed: then it is listed but not counted in totals, like the balance sheet. */
  inBooks: boolean;
  location: string | null;
  department: Department | null;
  assignedTo: { id: string; name: string } | null;
  project: { id: string; name: string; color: string } | null;
  projectUntil: string | null;
  isEquipment: boolean;
  condition: AssetCondition;
  warrantyUntil: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  funding: AssetFundingDTO;
  disposal: { date: string; amount: number; account: { id: string; name: string } | null; notes: string | null; bookValue: number; gain: number } | null;
  nextMaintenanceDue: string | null;
  archived: boolean;
};

export type MaintenanceEntryDTO = {
  id: string;
  date: string;
  description: string;
  /** The expense's amount when the cost was booked as an expense. */
  cost: number;
  vendor: string | null;
  nextDueDate: string | null;
  expense: { id: string; number: string; amount: number } | null;
};

/** One financial year of the schedule; `planned` months are after today. */
export type ScheduleYear = {
  label: string;
  opening: number;
  charge: number;
  closing: number;
  planned: boolean;
  months: { month: string; amount: number; closing: number; planned: boolean }[];
};

export type AssetDetail = AssetRow & {
  description: string | null;
  depreciationStart: string | null;
  warrantyNotes: string | null;
  notes: string | null;
  maintenance: MaintenanceEntryDTO[];
  maintenanceTotal: number;
  schedule: ScheduleYear[];
  /** True when the schedule shown stops before the end of the asset's life (written down value never ends). */
  scheduleCut: boolean;
  documents: FileDTO[];
  /** The unpaid bill created with this asset, when it can still be deleted along with it. */
  deletableBill: { id: string; number: string } | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** A group of the register with its totals (its own assets and every subgroup's). */
export type AssetGroupNode = {
  key: string;
  label: string;
  depth: number;
  builtIn: boolean;
  description: string | null;
  assets: AssetRow[];
  children: AssetGroupNode[];
  totals: AssetTotals;
};

export type AssetTotals = { count: number; cost: number; accumulated: number; bookValue: number; disposedCount: number };

export type AssetRegister = {
  rows: AssetRow[];
  tree: AssetGroupNode[];
  totals: AssetTotals;
  /** True when filters or a search narrowed the list. */
  filtered: boolean;
};

/** An expense that can be linked as the payment for an asset. */
export type LinkableExpense = {
  id: string;
  number: string;
  vendor: string;
  date: string;
  amount: number;
  gst: number;
  category: string;
  description: string | null;
  invoiceNumber: string | null;
  status: PaymentStatus;
};
