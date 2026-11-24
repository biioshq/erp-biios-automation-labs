"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarRange, FolderKanban, HandCoins, Percent, ReceiptText, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ComboboxField,
  DateField,
  FormSection,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { applyFieldErrors } from "@/lib/action-result";
import { DEPARTMENTS, PAYMENT_METHODS, PROJECT_STAGES, labelOf } from "@/lib/constants";
import { DEFAULT_EXPENSE_CATEGORIES, expenseCategoryChoices, type ExpenseCategoryOption } from "@/lib/expense-categories";
import { toDateInput } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { gstGrandTotal, isInterState, splitGst } from "@/lib/gst";
import { LOW_CONFIDENCE, type OcrResponse } from "@/lib/ocr";
import { GST_RATES } from "@/config/company";
import { emitDataChanged } from "@/lib/events";
import type { BankAccountOption, ProjectOption } from "@/server/lookups";
import type { FileDTO } from "@/features/files/types";
import { createExpense, discardUnsavedReceipt, updateExpense } from "../actions";
import { EXPENSE_PAYMENT_MODES, PAYING_METHODS, expenseFormSchema, type ExpenseFormInput, type ExpenseFormValues, type ExpensePaymentMode } from "../schemas";
import type { ExpenseDetail } from "../types";
import { ReceiptPanel } from "./receipt-panel";
import { accountChoices } from "./record-payment-dialog";
import { formValidation } from "@/components/forms/form-options";
import { useCan } from "@/components/current-user";
import { BankLineLink } from "@/features/finance/bank-statements/components/bank-line-link";

type Confidence = Partial<Record<FieldPath<ExpenseFormInput>, number>>;

const PAYMENT_OPTIONS = PAYING_METHODS;
const TAX_FIELDS = new Set(["gst.cgst", "gst.sgst", "gst.igst"]);

/** The payment mode an existing expense is shown with; none for one whose payments are recorded one by one. */
function modeOf(expense?: ExpenseDetail | null): ExpensePaymentMode | undefined {
  if (!expense) return "full";
  if (expense.payment.explicit || expense.bankMatched) return undefined;
  return expense.paymentMethod === "credit" ? "none" : "full";
}

function defaultsFrom(expense?: ExpenseDetail | null, projectId?: string): ExpenseFormInput {
  const g = expense?.gst;
  const mode = modeOf(expense);
  // An old "On credit" expense without a due date is due on its own date: shown as such, so saving keeps that meaning.
  const dueDate = expense?.dueDate ? toDateInput(expense.dueDate) : mode === "none" && expense ? toDateInput(expense.date) : undefined;
  return {
    vendor: expense?.vendor ?? "",
    vendorAddress: expense?.vendorAddress ?? "",
    projectId: expense?.project?.id ?? projectId ?? undefined,
    stage: expense?.stage ?? undefined,
    category: expense?.category ?? (undefined as unknown as ExpenseFormInput["category"]),
    description: expense?.description ?? "",
    amount: expense?.amount ?? (undefined as unknown as number),
    date: expense ? toDateInput(expense.date) : toDateInput(new Date()),
    paymentMethod: expense?.paymentMethod ?? "bank_transfer",
    notes: expense?.notes ?? "",
    gst: {
      gstin: g?.gstin ?? "",
      invoiceNumber: g?.invoiceNumber ?? "",
      invoiceDate: g?.invoiceDate ? toDateInput(g.invoiceDate) : undefined,
      taxableAmount: g?.taxableAmount || undefined,
      cgst: g?.cgst || undefined,
      sgst: g?.sgst || undefined,
      igst: g?.igst || undefined,
      cess: g?.cess || undefined,
      hsnSac: g?.hsnSac ?? "",
      grandTotal: g?.grandTotal || undefined,
    },
    receiptId: expense?.receipt?.id ?? undefined,
    ocr: expense?.ocr ?? undefined,
    payment: mode,
    paidAmount: undefined,
    accountId: expense?.account?.id ?? undefined,
    dueDate,
    department: expense?.department ?? undefined,
    prepaidFrom: expense?.prepaid ? toDateInput(expense.prepaid.from) : undefined,
    prepaidTo: expense?.prepaid ? toDateInput(expense.prepaid.to) : undefined,
  };
}

/**
 * Create or edit an expense. Left: the receipt (upload → OCR → preview).
 * Right: details, project & stage, the GST invoice section and notes.
 */
export function ExpenseForm({
  expense,
  projects,
  vendors,
  categories = DEFAULT_EXPENSE_CATEGORIES,
  accounts = [],
  defaultProjectId,
  onDone,
  onCancel,
}: {
  expense?: ExpenseDetail | null;
  projects: ProjectOption[];
  vendors: string[];
  /** Open bank and cash accounts for "Paid from" (getBankAccountOptions). Without them the method's default account is used. */
  accounts?: BankAccountOption[];
  /** Built-in and custom categories (getExpenseCategories); hidden ones are offered only as the record's current one. */
  categories?: ExpenseCategoryOption[];
  defaultProjectId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(expense);
  // Inventory expenses come from assignments; salary payments need the salaries data permission.
  const seesSalaries = useCan("data.salaries");
  const canDelete = useCan("finance.expenses:delete");
  const currentCategory = expense?.category;
  const currentLabel = expense?.categoryLabel;
  const categoryOptions = useMemo(() => {
    const choices = expenseCategoryChoices(categories, { current: currentCategory, allowSalaries: seesSalaries });
    // A record whose category the list does not know still shows the name its row was given.
    return choices.map((c) => (c.value === currentCategory && c.label === currentCategory && currentLabel ? { ...c, label: currentLabel } : c));
  }, [categories, currentCategory, currentLabel, seesSalaries]);
  // The rate of the last quick fill, while its taxes are untouched: they are split again if the GSTIN state changes.
  const quickRate = useRef<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<FileDTO | null>(expense?.receipt ?? null);
  const [confidence, setConfidence] = useState<Confidence>(() => {
    // Stored keys use "__" for "." (Mongo map keys cannot contain dots): gst__gstin → gst.gstin.
    const fields = expense?.ocr?.fields ?? {};
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([, c]) => c < LOW_CONFIDENCE)
        .map(([k, c]) => [k.replaceAll("__", "."), c]),
    ) as Confidence;
  });
  const [ocrSummary, setOcrSummary] = useState<{ filled: number; low: number; overall: number } | null>(null);

  const form = useForm<ExpenseFormInput, unknown, ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: defaultsFrom(expense, defaultProjectId),
    ...formValidation,
  });
  const { control, setValue, getValues } = form;

  // Once the user edits an auto-filled field, it no longer needs a highlight.
  useEffect(() => {
    const sub = form.watch((_, { name, type }) => {
      if (type === "change" && name) {
        if (TAX_FIELDS.has(name)) quickRate.current = null;
        setConfidence((c) => {
          if (!(name in c)) return c;
          const next = { ...c };
          delete next[name as keyof Confidence];
          return next;
        });
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  // GST: the amount follows taxable value + taxes whenever a taxable value is entered.
  const gst = useWatch({ control, name: "gst" });
  const projectId = useWatch({ control, name: "projectId" });
  const payment = useWatch({ control, name: "payment" });
  const amountNow = useWatch({ control, name: "amount" });
  const paidNow = useWatch({ control, name: "paidAmount" });
  const [prepaidOn, setPrepaidOn] = useState(Boolean(expense?.prepaid));
  const accountOptions = useMemo(() => accountChoices(accounts), [accounts]);
  const explicit = Boolean(expense?.payment.explicit);
  // Paid as a bank statement line shows: the payment and the amount stay as the line says.
  const bankMatched = Boolean(expense?.bankMatched);

  function setMode(next: string) {
    if (!next) return;
    const mode = next as ExpensePaymentMode;
    setValue("payment", mode, { shouldDirty: true });
    // "On credit" is how Not paid yet is stored; the other modes need a real method.
    if (mode === "none") setValue("paymentMethod", "credit");
    else if (getValues("paymentMethod") === "credit") setValue("paymentMethod", "bank_transfer");
    if (mode !== "partial") setValue("paidAmount", undefined);
  }

  function togglePrepaid(on: boolean) {
    setPrepaidOn(on);
    if (!on) {
      setValue("prepaidFrom", undefined, { shouldDirty: true });
      setValue("prepaidTo", undefined, { shouldDirty: true });
    }
  }
  const taxable = gst?.taxableAmount ?? 0;
  const grandTotal = gstGrandTotal(gst ?? {});
  const amountLocked = taxable > 0;
  useEffect(() => {
    if (taxable > 0) {
      setValue("gst.grandTotal", grandTotal);
      setValue("amount", grandTotal, { shouldValidate: form.formState.isSubmitted });
    }
  }, [taxable, grandTotal, setValue, form.formState.isSubmitted]);

  const interState = isInterState(gst?.gstin);

  function applyRate(rate: number, inter = interState) {
    const t = getValues("gst.taxableAmount") ?? 0;
    if (!t) {
      toast.info("Enter the taxable value first.");
      return;
    }
    const split = splitGst(t, rate, inter);
    setValue("gst.cgst", split.cgst || undefined, { shouldDirty: true });
    setValue("gst.sgst", split.sgst || undefined, { shouldDirty: true });
    setValue("gst.igst", split.igst || undefined, { shouldDirty: true });
    quickRate.current = rate;
  }

  // A rate picked before the GSTIN was typed used the wrong heads (CGST + SGST vs IGST): split it again.
  // Taxes typed by hand or read from a receipt are left as they are.
  useEffect(() => {
    if (quickRate.current !== null && (getValues("gst.taxableAmount") ?? 0) > 0) applyRate(quickRate.current, interState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of state matters here
  }, [interState]);

  function applyOcr(result: OcrResponse) {
    const previous = getValues("receiptId");
    if (previous && previous !== expense?.receipt?.id) void discardUnsavedReceipt(previous);
    setReceipt(result.file);
    setValue("receiptId", result.file.id, { shouldDirty: true });
    if (!result.ocr) return;
    quickRate.current = null;

    const f = result.ocr.fields;
    const next: Confidence = {};
    let filled = 0;
    const put = <K extends FieldPath<ExpenseFormInput>>(path: K, field: { value: unknown; confidence: number }, value?: unknown) => {
      if (field.value === null || field.value === undefined || field.value === "") return;
      setValue(path, (value ?? field.value) as never, { shouldDirty: true });
      next[path] = field.confidence;
      filled++;
    };
    put("vendor", f.vendorName);
    put("vendorAddress", f.vendorAddress);
    put("gst.gstin", f.gstin);
    put("gst.invoiceNumber", f.invoiceNumber);
    put("gst.invoiceDate", f.invoiceDate);
    if (f.invoiceDate.value) {
      setValue("date", f.invoiceDate.value);
      next.date = f.invoiceDate.confidence;
    }
    put("gst.taxableAmount", f.taxableAmount);
    put("gst.cgst", f.cgst);
    put("gst.sgst", f.sgst);
    put("gst.igst", f.igst);
    put("gst.cess", f.cess);
    put("gst.hsnSac", f.hsnSac);
    if (f.totalAmount.value !== null) {
      put("amount", f.totalAmount);
      if (!f.taxableAmount.value) setValue("gst.grandTotal", f.totalAmount.value);
    }
    if (f.paymentMethod.value === "credit" && !explicit) {
      setMode("none");
      next.paymentMethod = f.paymentMethod.confidence;
    } else if (f.paymentMethod.value && PAYMENT_OPTIONS.some((o) => o.value === f.paymentMethod.value)) {
      put("paymentMethod", f.paymentMethod);
      if (getValues("payment") === "none") setValue("payment", "full");
    }
    setValue("ocr", {
      overall: result.ocr.overallConfidence,
      source: result.ocr.source,
      // Mongo map keys cannot contain dots, so form paths are stored as gst__gstin.
      fields: Object.fromEntries(Object.entries(next).map(([k, v]) => [k.replaceAll(".", "__"), v ?? 0])),
    });

    setConfidence(next);
    const low = Object.values(next).filter((c) => (c ?? 1) < LOW_CONFIDENCE).length;
    setOcrSummary({ filled, low, overall: result.ocr.overallConfidence });
    if (filled === 0) toast.warning("We couldn't find invoice details on this receipt. Fill the form by hand.");
    else toast.success(`Read ${filled} field${filled === 1 ? "" : "s"} from the receipt`, {
      description: low ? `${low} highlighted field${low === 1 ? "" : "s"} need a check.` : `In ${(result.ocr.durationMs / 1000).toFixed(1)}s`,
    });
  }

  function removeReceipt() {
    const current = getValues("receiptId");
    if (current && current !== expense?.receipt?.id) void discardUnsavedReceipt(current);
    setReceipt(null);
    setValue("receiptId", undefined, { shouldDirty: true });
    setValue("ocr", undefined);
    setOcrSummary(null);
    setConfidence({});
  }

  function cancel() {
    const current = getValues("receiptId");
    if (current && current !== expense?.receipt?.id) void discardUnsavedReceipt(current);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    // With the switch on, both days are needed; the schema alone would save the expense without them.
    if (prepaidOn && (!values.prepaidFrom || !values.prepaidTo)) {
      if (!values.prepaidFrom) form.setError("prepaidFrom", { message: "Pick the first day covered" });
      if (!values.prepaidTo) form.setError("prepaidTo", { message: "Pick the last day covered" });
      return;
    }
    startTransition(async () => {
      const result = expense ? await updateExpense({ ...values, id: expense.id }) : await createExpense(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  const c = (path: FieldPath<ExpenseFormInput>) => confidence[path];
  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.value,
        label: p.label,
        description: p.description,
        disabled: p.status === "cancelled",
        icon: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects],
  );

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ReceiptPanel
          receipt={receipt}
          onRead={applyOcr}
          onRemove={removeReceipt}
          // Removing or replacing the saved receipt deletes the file, which needs the delete permission.
          locked={!canDelete && Boolean(receipt) && receipt?.id === expense?.receipt?.id}
          summary={ocrSummary}
          className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-170px)]"
        />

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor="vendor" className="flex items-center gap-1 text-[13px]">
                Vendor<span className="text-danger">*</span>
                {c("vendor") !== undefined ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 py-px text-[10px] font-medium",
                      (c("vendor") ?? 1) < LOW_CONFIDENCE ? "bg-warning/15 text-warning" : "bg-success/10 text-success",
                    )}
                  >
                    {Math.round((c("vendor") ?? 0) * 100)}%
                  </span>
                ) : null}
              </FieldLabel>
              <Input
                id="vendor"
                list="expense-vendors"
                autoComplete="off"
                placeholder="Who was paid"
                aria-invalid={Boolean(form.formState.errors.vendor)}
                className={cn((c("vendor") ?? 1) < LOW_CONFIDENCE && "border-warning/70 bg-warning/5 ring-2 ring-warning/20")}
                {...form.register("vendor")}
              />
              <datalist id="expense-vendors">
                {vendors.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              {form.formState.errors.vendor ? (
                <p className="text-xs text-destructive">{form.formState.errors.vendor.message}</p>
              ) : null}
            </Field>
            <NumberField
              control={control}
              name="amount"
              label="Amount"
              currency
              required
              confidence={c("amount")}
              disabled={amountLocked || bankMatched}
              description={bankMatched ? "As on the bank statement line" : amountLocked ? "Taxable value + GST" : "Bill total, tax included"}
            />
            <DateField control={control} name="date" label="Expense date" required confidence={c("date")} />
            {expense?.capitalAsset ? (
              <p className="rounded-lg border bg-card px-4 py-3 text-sm sm:col-span-2">
                This expense paid for the fixed asset{" "}
                <Link href={`/finance/assets/fixed?view=${expense.capitalAsset.id}`} className="font-medium text-brand-ink hover:underline">
                  {expense.capitalAsset.name} ({expense.capitalAsset.code})
                </Link>
                .{" "}
                <span className="text-muted-foreground">
                  Its date stays {formatDate(expense.date)} and its amount can&apos;t go below the asset&apos;s cost of{" "}
                  {formatCurrency(expense.capitalAsset.purchaseCost, { exact: true })}. To change either, change or unlink the asset first.
                </span>
              </p>
            ) : null}
            <SelectField
              control={control}
              name="category"
              label="Category"
              required
              options={categoryOptions}
              placeholder="Choose a category"
            />
            <SelectField
              control={control}
              name="department"
              label="Department"
              options={DEPARTMENTS}
              clearable
              placeholder="Not set"
            />
            <TextField
              control={control}
              name="description"
              label="Description"
              placeholder="What was this for?"
              className="sm:col-span-2"
            />
          </div>

          <FormSection
            title="Payment"
            description={
              explicit
                ? "Payments on this expense are recorded one by one."
                : bankMatched
                  ? "Paid as the bank statement shows."
                : payment === "partial"
                  ? "What was paid on the expense date. Record later payments from the expense or Payment tracking."
                  : payment === "none"
                    ? "Saved as on credit. Record payments from the expense or Payment tracking when you pay."
                    : "Paid on the expense date."
            }
            icon={<HandCoins />}
          >
            {explicit && expense ? (
              <div className="space-y-4">
                <p className="rounded-lg border bg-card px-4 py-3 text-sm">
                  {formatCurrency(expense.payment.paid, { exact: true })} paid in {expense.payments.length}{" "}
                  {expense.payments.length === 1 ? "payment" : "payments"}
                  {expense.payment.outstanding > 0 ? `, ${formatCurrency(expense.payment.outstanding, { exact: true })} still owed.` : ", nothing owed."}{" "}
                  <span className="text-muted-foreground">
                    Record or delete payments from the expense drawer or Payment tracking. The amount can&apos;t go below what is paid.
                  </span>
                </p>
                {expense.payment.outstanding > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DateField control={control} name="dueDate" label="Rest due on" clearable />
                  </div>
                ) : null}
              </div>
            ) : bankMatched && expense ? (
              <p className="rounded-lg border bg-card px-4 py-3 text-sm">
                Paid in full on {formatDate(expense.date)} by {labelOf(PAYMENT_METHODS, expense.paymentMethod).toLowerCase()}
                {expense.account ? ` from ${expense.account.name}` : ""}.{" "}
                <span className="text-muted-foreground">
                  It is matched to a bank statement line, so its payment and amount stay as the statement shows.
                </span>{" "}
                <BankLineLink id={expense.bankTransactionId} label="Unmatch it in Bank statements" />
              </p>
            ) : (
              <div className="space-y-4">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={payment ?? "full"}
                  onValueChange={setMode}
                  className="w-full flex-wrap sm:flex-nowrap"
                  aria-label="Payment status"
                >
                  {EXPENSE_PAYMENT_MODES.map((m) => (
                    <ToggleGroupItem key={m.value} value={m.value} className="min-w-28 flex-1 max-md:h-10">
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  {payment === "partial" ? (
                    <NumberField
                      control={control}
                      name="paidAmount"
                      label="Amount paid now"
                      currency
                      required
                      description={
                        amountNow && paidNow && paidNow < amountNow
                          ? `${formatCurrency(amountNow - paidNow, { exact: true })} left to pay`
                          : "Paid on the expense date"
                      }
                    />
                  ) : null}
                  {payment !== "none" ? (
                    <>
                      <SelectField
                        control={control}
                        name="paymentMethod"
                        label="Payment method"
                        required
                        options={PAYMENT_OPTIONS}
                        confidence={c("paymentMethod")}
                      />
                      <SelectField
                        control={control}
                        name="accountId"
                        label="Paid from"
                        options={accountOptions}
                        clearable
                        disabled={!accountOptions.length}
                        placeholder={accountOptions.length ? "Default for the method" : "No accounts set up"}
                        description={accountOptions.length ? undefined : "Bank accounts are set up under Assets, Cash & bank."}
                      />
                    </>
                  ) : null}
                  {payment === "partial" || payment === "none" ? (
                    <DateField control={control} name="dueDate" label={payment === "none" ? "Due on" : "Rest due on"} required />
                  ) : null}
                </div>
              </div>
            )}
          </FormSection>

          <FormSection
            title="Project & stage"
            description="Project expenses count toward its budget and stage-wise spending."
            icon={<FolderKanban />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <ComboboxField
                control={control}
                name="projectId"
                label="Project"
                options={projectOptions}
                placeholder="Company overhead (no project)"
                searchPlaceholder="Search projects…"
                clearable
                onSelected={(v) => !v && setValue("stage", undefined)}
              />
              <SelectField
                control={control}
                name="stage"
                label="Stage"
                required={Boolean(projectId)}
                disabled={!projectId}
                options={PROJECT_STAGES}
                placeholder={projectId ? "Choose a stage" : "Pick a project first"}
              />
            </div>
          </FormSection>

          <FormSection
            title="GST details"
            description={
              gst?.gstin
                ? interState
                  ? "Supplier is in another state: IGST applies."
                  : "Supplier is in your state: CGST + SGST apply."
                : "From the tax invoice. Leave empty for bills without GST."
            }
            icon={<Percent />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={control}
                name="gst.gstin"
                label="Supplier GSTIN"
                placeholder="27AAPFU0939F1ZV"
                mono
                transform={(v) => v.toUpperCase().replace(/\s/g, "")}
                confidence={c("gst.gstin")}
              />
              <TextField control={control} name="gst.invoiceNumber" label="Invoice number" mono confidence={c("gst.invoiceNumber")} />
              <DateField control={control} name="gst.invoiceDate" label="Invoice date" clearable confidence={c("gst.invoiceDate")} />
              <TextField control={control} name="gst.hsnSac" label="HSN / SAC" placeholder="8536, 998314" mono confidence={c("gst.hsnSac")} />
              <NumberField control={control} name="gst.taxableAmount" label="Taxable amount" currency confidence={c("gst.taxableAmount")} />
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium">Quick fill GST rate</p>
                <div className="flex flex-wrap gap-1">
                  {GST_RATES.map((rate) => (
                    <Button key={rate} type="button" variant="outline" size="sm" className="tabular h-8 px-2.5" onClick={() => applyRate(rate)}>
                      {rate}%
                    </Button>
                  ))}
                </div>
              </div>
              <NumberField control={control} name="gst.cgst" label="CGST" currency confidence={c("gst.cgst")} />
              <NumberField control={control} name="gst.sgst" label="SGST" currency confidence={c("gst.sgst")} />
              <NumberField control={control} name="gst.igst" label="IGST" currency confidence={c("gst.igst")} />
              <NumberField control={control} name="gst.cess" label="CESS" currency confidence={c("gst.cess")} />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <span className="text-sm text-muted-foreground">Grand total</span>
              <Money value={taxable > 0 ? grandTotal : (form.getValues("amount") ?? 0)} className="text-lg font-semibold" />
            </div>
            <TextareaField
              control={control}
              name="vendorAddress"
              label="Vendor address"
              rows={2}
              placeholder="As printed on the invoice"
              confidence={c("vendorAddress")}
            />
          </FormSection>

          <FormSection
            title="Prepaid for a period"
            description="For a payment that covers time ahead, such as a yearly insurance premium or software licence. The profit and loss spreads the cost over these days; the payment itself still counts on its date."
            icon={<CalendarRange />}
            actions={<Switch checked={prepaidOn} onCheckedChange={togglePrepaid} aria-label="Prepaid for a period" />}
          >
            {prepaidOn ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <DateField control={control} name="prepaidFrom" label="First day covered" required />
                <DateField control={control} name="prepaidTo" label="Last day covered" required />
              </div>
            ) : null}
          </FormSection>

          <FormSection title="Remarks" icon={<StickyNote />}>
            <TextareaField control={control} name="notes" placeholder="Anything the accountant should know" rows={3} />
          </FormSection>
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <ReceiptText className="size-3.5" />
          {receipt ? "Receipt attached" : "No receipt attached"}
        </span>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Add expense"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
