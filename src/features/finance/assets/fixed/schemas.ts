import { z } from "zod";
import { ASSET_CONDITIONS, ASSET_FUNDING, DEPARTMENTS, DEPRECIATION_METHODS, PAYMENT_METHODS, valuesOf } from "@/lib/constants";
import { dateInput, money, objectId, optionalDateInput, optionalMoney, optionalObjectId, optionalText, requiredText } from "@/lib/zod";

/** Validation shared by the asset forms (client) and the asset actions (server). Client-safe. */

/** Methods that pay money out of an account now ("Paid from a bank or cash account"). */
export const PAID_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "credit" && m.value !== "stock");
/** Methods a maintenance expense can carry ("On credit" = the bill is not paid yet). */
export const EXPENSE_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "stock");

const optionalNumber = (max: number) =>
  z
    .number()
    .finite()
    .min(0, "Cannot be negative")
    .max(max, `At most ${max}`)
    .optional();

export const fundingSchema = z.object({
  mode: z.enum(valuesOf(ASSET_FUNDING), { error: "Pick how it was paid" }),
  /** "expense": the expense already recorded. */
  expenseId: optionalObjectId,
  /** "paid": how and from which account. */
  paymentMethod: z.enum(valuesOf(PAYMENT_METHODS)).optional(),
  accountId: optionalObjectId,
  /** "unpaid": when the bill falls due. */
  dueDate: optionalDateInput,
});

export const assetFormSchema = z
  .object({
    kind: z.enum(["tangible", "intangible"]),
    name: requiredText("Name", 160),
    group: z.string({ error: "Pick a group" }).trim().min(1, "Pick a group").max(80),
    description: optionalText(2000),
    quantity: z.number({ error: "Enter a quantity" }).finite().positive("Must be more than zero").max(1e6, "That is too many"),
    purchaseDate: dateInput,
    purchaseCost: money,
    salvageValue: optionalMoney,
    usefulLifeYears: optionalNumber(100),
    depreciationMethod: z.enum(valuesOf(DEPRECIATION_METHODS)),
    wdvRate: optionalNumber(100),
    depreciationStart: optionalDateInput,
    vendor: optionalText(200),
    invoiceNumber: optionalText(80),
    location: optionalText(120),
    department: z
      .enum(valuesOf(DEPARTMENTS))
      .optional()
      .or(z.literal("").transform(() => undefined)),
    assignedToId: optionalObjectId,
    isEquipment: z.boolean(),
    projectId: optionalObjectId,
    projectUntil: optionalDateInput,
    condition: z.enum(valuesOf(ASSET_CONDITIONS)),
    warrantyUntil: optionalDateInput,
    warrantyNotes: optionalText(1000),
    notes: optionalText(4000),
    funding: fundingSchema,
    /** Fresh uploads to attach to the asset. */
    documentIds: z.array(objectId).max(20).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (v.depreciationMethod === "slm" && !(v.usefulLifeYears && v.usefulLifeYears > 0)) issue(["usefulLifeYears"], "Enter the useful life in years");
    if (v.depreciationMethod === "wdv" && !(v.wdvRate && v.wdvRate > 0)) issue(["wdvRate"], "Enter the yearly rate");
    if ((v.salvageValue ?? 0) > v.purchaseCost) issue(["salvageValue"], "Cannot be more than the purchase cost");
    if (v.depreciationStart && v.depreciationStart < v.purchaseDate) issue(["depreciationStart"], "Cannot be before the purchase date");
    if (v.projectUntil && !v.projectId) issue(["projectUntil"], "Pick the project first");
    if (v.projectUntil && v.projectUntil < v.purchaseDate) issue(["projectUntil"], "Cannot be before the purchase date");
    const f = v.funding;
    if (f.mode === "expense" && !f.expenseId) issue(["funding", "expenseId"], "Pick the expense that paid for it");
    if (f.mode === "paid" && (!f.paymentMethod || f.paymentMethod === "credit" || f.paymentMethod === "stock")) {
      issue(["funding", "paymentMethod"], "Pick how it was paid");
    }
    if (f.mode === "unpaid") {
      if (!v.vendor) issue(["vendor"], "Enter who the bill is from");
      if (v.purchaseCost <= 0) issue(["purchaseCost"], "Enter what is owed");
      if (f.dueDate && f.dueDate < v.purchaseDate) issue(["funding", "dueDate"], "Cannot be before the purchase date");
    }
  });

export type AssetFormInput = z.input<typeof assetFormSchema>;
export type AssetFormValues = z.output<typeof assetFormSchema>;

export const assetIdSchema = z.object({ id: objectId });

export const updateAssetSchema = assetFormSchema.and(
  z.object({
    id: objectId,
    /** When the asset stops pointing at the unpaid bill it created, delete that bill (only if nothing was paid on it). */
    deleteBill: z.boolean().optional(),
  }),
);

export const maintenanceFormSchema = z
  .object({
    assetId: objectId,
    /** Set when editing an entry. */
    entryId: optionalObjectId,
    date: dateInput,
    description: requiredText("What was done", 1000),
    cost: money,
    vendor: optionalText(200),
    nextDueDate: optionalDateInput,
    /** Also book the cost as a normal expense, so it is entered once. */
    recordExpense: z.boolean(),
    paymentMethod: z.enum(valuesOf(PAYMENT_METHODS)).optional(),
    accountId: optionalObjectId,
  })
  .superRefine((v, ctx) => {
    if (v.nextDueDate && v.nextDueDate < v.date) ctx.addIssue({ code: "custom", path: ["nextDueDate"], message: "Cannot be before the service date" });
    if (!v.recordExpense) return;
    if (!v.vendor) ctx.addIssue({ code: "custom", path: ["vendor"], message: "Enter who did the work, for the expense" });
    if (v.cost <= 0) ctx.addIssue({ code: "custom", path: ["cost"], message: "Enter the cost, for the expense" });
    if (!v.paymentMethod || v.paymentMethod === "stock") ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Pick how it was paid" });
  });
export type MaintenanceFormInput = z.input<typeof maintenanceFormSchema>;
export type MaintenanceFormValues = z.output<typeof maintenanceFormSchema>;

export const maintenanceIdSchema = z.object({ assetId: objectId, entryId: objectId });

export const disposalFormSchema = z.object({
  id: objectId,
  date: dateInput,
  /** Sale proceeds; 0 when scrapped, lost or given away. */
  amount: money,
  accountId: optionalObjectId,
  notes: optionalText(1000),
});
export type DisposalFormInput = z.input<typeof disposalFormSchema>;
export type DisposalFormValues = z.output<typeof disposalFormSchema>;

export const deleteAssetSchema = z.object({
  id: objectId,
  /** Also delete the unpaid bill that was created with the asset (only when nothing was paid on it). */
  deleteBill: z.boolean().optional(),
});

export const attachDocumentsSchema = z.object({ id: objectId, fileIds: z.array(objectId).min(1).max(20) });
export const removeDocumentSchema = z.object({ id: objectId, fileId: objectId });

export const linkableExpenseSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** The asset being edited: its own expense stays pickable. */
  assetId: optionalObjectId,
});

/** Filter keys accepted in the URL of the register. */
export const ASSET_FILTER_KEYS = ["group", "condition", "location", "department", "project", "status"] as const;
export const ASSET_SORT_KEYS = ["code", "name", "purchaseDate", "purchaseCost", "bookValue"] as const;

/** "status" filter values: still in the books, disposed (sold, scrapped), archived (hidden by default). */
export const ASSET_STATUSES = [
  { value: "in_use", label: "In the books" },
  { value: "disposed", label: "Disposed" },
  { value: "archived", label: "Archived" },
] as const;
