import type { ScenarioStatus, ScenarioType } from "@/lib/constants";
import type { ColumnType } from "@/features/reports/types";

/**
 * The one result shape every scenario type returns. The detail page, the comparison page, the
 * saved-versus-today check and the Excel and PDF exports all read it, so a figure is shown the same
 * way everywhere. JSON-safe on purpose (dates are "yyyy-mm-dd" strings): it is stored as is.
 */

export type ValueType = ColumnType;
export type Cell = string | number | null;

/** A headline figure. */
export type ResultStat = {
  key: string;
  label: string;
  type: ValueType;
  value: Cell;
  /** "pcs", "days": shown after numbers. */
  unit?: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
};

/** A row of "Current position vs scenario". Difference is scenario minus current; null when it means nothing. */
export type ComparisonRow = {
  key: string;
  parameter: string;
  type: ValueType;
  unit?: string;
  current: Cell;
  scenario: Cell;
  difference: Cell;
};

export type ResultColumn = { key: string; header: string; type: ValueType; unit?: string };

export type ResultRow = {
  cells: Record<string, Cell>;
  /** Column key to a page that shows the record. */
  links?: Record<string, string>;
  tone?: "warning" | "danger";
};

export type ResultTable = {
  key: string;
  title: string;
  description?: string;
  columns: ResultColumn[];
  rows: ResultRow[];
  totals?: Record<string, Cell> | null;
  /** Shown instead of an empty table: what is missing and why. */
  emptyText?: string;
};

export type ResultChart = {
  title: string;
  description?: string;
  type: "money" | "number";
  currentLabel: string;
  scenarioLabel: string;
  points: { label: string; current: number; scenario: number }[];
};

/** Something the client asked about that the ERP does not record. Shown as an empty state, never as a number. */
export type NotRecorded = { label: string; detail: string };

/**
 * The comparison measures. null = does not apply to this type (a dash on the comparison page).
 * Money in rupees, quantities in their own units.
 */
export type ScenarioMetrics = {
  /** Extra material needed, per unit ("pcs", "m"), positive = more. */
  materials: { unit: string; qty: number }[] | null;
  procurementCost: number | null;
  /** Added to the spend of the affected projects. */
  projectCost: number | null;
  /** Change in an allocated budget (budget planning). */
  budgetChange: number | null;
  /** Spend above the budgets of the affected projects or allocation once the scenario plays out. */
  overBudget: number | null;
  manpowerPeople: number | null;
  manpowerCost: number | null;
  equipmentShort: number | null;
  equipmentCost: number | null;
  /** Days a project could slip. */
  delayDays: number | null;
  /** Materials that would run short. */
  shortItems: number | null;
  /** Cash the scenario needs beyond what it already has (admins only). */
  cashNeed: number | null;
  risks: string[];
};

export type ScenarioResults = {
  version: 1;
  type: ScenarioType;
  /** ISO instant. */
  computedAt: string;
  /** Whose view the figures were computed for: members never get salary or cash figures. */
  view: "admin" | "member";
  /** One plain sentence: what the scenario means. */
  headline: string;
  stats: ResultStat[];
  comparison: ComparisonRow[];
  tables: ResultTable[];
  chart: ResultChart | null;
  metrics: ScenarioMetrics;
  /** How figures were worked out (price basis, windows, splits). */
  notes: string[];
  notRecorded: NotRecorded[];
};

export type HistoryEntry = {
  at: string;
  byName: string | null;
  action: string;
  changes: string[];
  status: ScenarioStatus | null;
  note: string | null;
};

/** A row in the scenario list. */
export type ScenarioRow = {
  id: string;
  code: string;
  name: string;
  type: ScenarioType;
  status: ScenarioStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScenarioDetail = ScenarioRow & {
  description: string | null;
  assumptions: string | null;
  /** Stored inputs, admin-only fields removed for members. */
  inputs: Record<string, unknown>;
  /** Input values as label and readable value, for the detail page and exports. */
  inputSummary: { label: string; value: string }[];
  duplicatedFrom: { id: string; code: string; name: string } | null;
  history: HistoryEntry[];
  /** The saved snapshot, or null when there is none or the viewer may not see it. */
  saved: ScenarioResults | null;
  savedAt: string | null;
  /** Why the saved snapshot is hidden from this viewer. */
  savedHidden: string | null;
  /** Set when the saved figures were worked out for the other view (member or admin), so they differ for that reason. */
  savedNote: string | null;
  /** Recomputed from today's data; null when the stored inputs no longer validate. */
  live: ScenarioResults | null;
  liveError: string | null;
  /** Parameters whose saved and live figures differ. */
  changedSinceSave: string[];
};

/** A row of the history page. */
export type HistoryRow = HistoryEntry & {
  key: string;
  scenario: { id: string; code: string; name: string; type: ScenarioType; status: ScenarioStatus };
};

/* Form options */

export type ProjectChoice = {
  value: string;
  label: string;
  description: string;
  status: string;
  color: string;
  budget: number;
  stageBudgets: Record<string, number>;
};
export type ItemChoice = {
  value: string;
  label: string;
  description: string;
  unit: string;
  available: number;
  averageCost: number;
  lastPurchasePrice: number | null;
};
export type EquipmentChoice = { value: string; label: string; description: string; quantity: number };
export type DepartmentChoice = {
  value: string;
  label: string;
  active: number;
  /** Average monthly salary of active people; admins only (null for members). */
  averageSalary: number | null;
};

export type ScenarioFormOptions = {
  projects: ProjectChoice[];
  items: ItemChoice[];
  vendors: string[];
  equipment: EquipmentChoice[];
  departments: DepartmentChoice[];
  skills: string[];
};

/** Prefill for the demand form: what the chosen projects hold of each material. */
export type DemandPrefill = Record<string, number>;
