"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowDownToLine, PackagePlus, Percent, ReceiptText, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { DateField, FormSection, NumberField, TextField, TextareaField } from "@/components/forms/fields";
import { Money } from "@/components/shared/money";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { gstGrandTotal, isInterState, splitGst } from "@/lib/gst";
import { getStockStatus } from "@/lib/stock-status";
import { GST_RATES } from "@/config/company";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_RECEIPTS, type FileDTO } from "@/features/files/types";
import { discardPurchaseReceipt, purchaseStockAction } from "../actions";
import { purchaseFormSchema, type PurchaseFormInput, type PurchaseFormValues } from "../schemas";
import type { LedgerItem } from "../types";
import { ItemCard, StatusDot } from "./item-card";
import { ContextPlaceholder, ImpactRow, OperationForm, OperationLayout, SubmitBar } from "./operation-layout";
import { PickerField, type PickerOption } from "./picker-field";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { formValidation } from "@/components/forms/form-options";

const FORM_ID = "purchase-stock-form";

function defaultsFor(item?: LedgerItem, quantity?: number): PurchaseFormInput {
  return {
    itemId: item?.id as string,
    quantity: quantity as number,
    unitPrice: (item ? (item.lastPurchasePrice ?? item.unitPrice) || undefined : undefined) as number,
    vendor: item?.vendor ?? "",
    date: toDateInput(new Date()),
    invoice: {
      invoiceNumber: "",
      invoiceDate: undefined,
      gstin: "",
      taxableAmount: undefined,
      cgst: undefined,
      sgst: undefined,
      igst: undefined,
      cess: undefined,
      hsnSac: "",
    },
    receiptFileId: undefined,
    note: "",
  };
}

export function PurchaseView({
  items,
  vendors,
  defaultItemId,
  defaultQuantity,
  recent,
}: {
  items: LedgerItem[];
  vendors: string[];
  defaultItemId?: string;
  defaultQuantity?: number;
  recent: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<FileDTO | null>(null);
  const initialItem = items.find((i) => i.id === defaultItemId);
  const [showInvoice, setShowInvoice] = useState(false);

  const form = useForm<PurchaseFormInput, unknown, PurchaseFormValues>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: defaultsFor(initialItem, defaultQuantity),
    ...formValidation,
  });
  const { control, setValue, getValues } = form;

  const itemId = useWatch({ control, name: "itemId" });
  const qty = useWatch({ control, name: "quantity" });
  const unitPrice = useWatch({ control, name: "unitPrice" });
  const invoice = useWatch({ control, name: "invoice" });
  const item = items.find((i) => i.id === itemId);

  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const price = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;
  const lineTotal = round2(quantity * price);
  const taxable = invoice?.taxableAmount ?? 0;
  const invoiceSum = gstGrandTotal(invoice ?? {});
  const interState = isInterState(invoice?.gstin);

  const options = useMemo<PickerOption[]>(
    () =>
      items.map((i) => ({
        value: i.id,
        label: i.name,
        description: `${i.sku} · ${formatNumber(i.available)} ${i.unit} available`,
        leading: <StatusDot status={i.status} />,
        trailing: i.status === "in_stock" ? undefined : <StockStatusBadge status={i.status} />,
      })),
    [items],
  );

  function onItemSelected(id: string | undefined) {
    const picked = items.find((i) => i.id === id);
    if (!picked) return;
    const last = picked.lastPurchasePrice ?? picked.unitPrice;
    if (last > 0) setValue("unitPrice", last, { shouldDirty: true });
    if (picked.vendor && !getValues("vendor")) setValue("vendor", picked.vendor, { shouldDirty: true });
  }

  function applyRate(rate: number) {
    const t = getValues("invoice.taxableAmount") ?? 0;
    if (!t) {
      toast.info("Enter the taxable amount first.");
      return;
    }
    const split = splitGst(t, rate, interState);
    setValue("invoice.cgst", split.cgst || undefined, { shouldDirty: true });
    setValue("invoice.sgst", split.sgst || undefined, { shouldDirty: true });
    setValue("invoice.igst", split.igst || undefined, { shouldDirty: true });
  }

  function toggleInvoice(on: boolean) {
    setShowInvoice(on);
    if (!on) setValue("invoice", defaultsFor().invoice, { shouldDirty: true });
  }

  function dropReceipt() {
    const current = getValues("receiptFileId");
    if (current) void discardPurchaseReceipt(current);
    setReceipt(null);
    setValue("receiptFileId", undefined, { shouldDirty: true });
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await purchaseStockAction(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const r = result.data;
      toast.success(
        `Purchased ${formatNumber(r.quantity)} ${r.unit} of ${r.itemName} at ${formatCurrency(r.unitPrice)} each (${formatCurrency(r.total)}). Available is now ${formatNumber(r.available)}.`,
      );
      emitDataChanged();
      form.reset({ ...defaultsFor(), itemId: "" });
      setReceipt(null);
      setShowInvoice(false);
    });
  });

  // What the item looks like once this purchase is recorded (weighted average, as the ledger computes it).
  const after = item && quantity > 0 ? previewPurchase(item, quantity, price) : null;

  const submitBar = (className: string) => (
    <SubmitBar
      className={className}
      formId={FORM_ID}
      pending={pending}
      label="Record purchase"
      icon={<PackagePlus />}
      note={
        lineTotal > 0 ? (
          <>
            Adds <span className="tabular font-medium text-foreground">{formatNumber(quantity)}</span> {item?.unit ?? "units"} to stock
          </>
        ) : (
          "Nothing recorded until you save."
        )
      }
    />
  );

  return (
    <OperationLayout
      recent={recent}
      form={
        <OperationForm id={FORM_ID} onSubmit={onSubmit}>
          <PickerField
            control={control}
            name="itemId"
            label="Item"
            required
            options={options}
            placeholder="Choose the item you bought"
            searchPlaceholder="Search by name or SKU…"
            emptyText="No matching item. Add it under All Inventory first."
            onSelected={onItemSelected}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="quantity" label="Quantity" required suffix={item?.unit} />
            <NumberField
              control={control}
              name="unitPrice"
              label="Unit price"
              currency
              // Cheap units can cost fractions of a paisa (₹0.525 a gram), and that price is kept as entered.
              step="any"
              required
              description={item?.lastPurchasePrice ? `Last paid ${formatCurrency(item.lastPurchasePrice)}. Excludes GST.` : "Price per unit, excluding GST"}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border bg-surface/40 px-4 py-3">
            <span className="min-w-0 text-sm text-muted-foreground">
              Line total
              {quantity > 0 && price > 0 ? (
                <span className="tabular ml-2 text-xs">
                  {formatNumber(quantity)} × {formatCurrency(price)}
                </span>
              ) : null}
            </span>
            <Money value={lineTotal} className="text-lg font-semibold" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="vendor" className="text-[13px]">
                Vendor
              </FieldLabel>
              <Input id="vendor" list="purchase-vendors" autoComplete="off" placeholder="Who supplied it" {...form.register("vendor")} />
              <datalist id="purchase-vendors">
                {vendors.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              {form.formState.errors.vendor ? <p className="text-xs text-destructive">{form.formState.errors.vendor.message}</p> : null}
            </Field>
            <DateField control={control} name="date" label="Purchase date" required />
          </div>

          <FormSection
            title="GST invoice"
            description={
              showInvoice
                ? invoice?.gstin
                  ? interState
                    ? "Supplier is in another state: IGST applies."
                    : "Supplier is in your state: CGST + SGST apply."
                  : "Tax paid here counts toward GST input credit."
                : "Add the supplier's tax invoice to claim input credit."
            }
            icon={<Percent />}
            actions={<Switch checked={showInvoice} onCheckedChange={toggleInvoice} aria-label="Add GST invoice" />}
          >
            {showInvoice ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField control={control} name="invoice.invoiceNumber" label="Invoice number" mono />
                  <DateField control={control} name="invoice.invoiceDate" label="Invoice date" clearable />
                  <TextField
                    control={control}
                    name="invoice.gstin"
                    label="Supplier GSTIN"
                    placeholder="27AAPFU0939F1ZV"
                    mono
                    transform={(v) => v.toUpperCase().replace(/\s/g, "")}
                  />
                  <TextField control={control} name="invoice.hsnSac" label="HSN / SAC" placeholder="8536, 998314" mono />
                  <div className="space-y-1.5">
                    <NumberField control={control} name="invoice.taxableAmount" label="Taxable amount" currency />
                    {lineTotal > 0 && taxable !== lineTotal ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand-ink hover:underline"
                        onClick={() => setValue("invoice.taxableAmount", lineTotal, { shouldDirty: true })}
                      >
                        Use line total ({formatCurrency(lineTotal)})
                      </button>
                    ) : null}
                  </div>
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
                  <NumberField control={control} name="invoice.cgst" label="CGST" currency />
                  <NumberField control={control} name="invoice.sgst" label="SGST" currency />
                  <NumberField control={control} name="invoice.igst" label="IGST" currency />
                  <NumberField control={control} name="invoice.cess" label="CESS" currency />
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
                  <span className="text-sm text-muted-foreground">Invoice total</span>
                  <Money value={taxable > 0 ? invoiceSum : lineTotal} className="text-lg font-semibold" />
                </div>
                {taxable > 0 && lineTotal > 0 && Math.abs(taxable - lineTotal) > 1 ? (
                  <p className="text-xs text-warning">
                    The taxable amount differs from the line total by {formatCurrency(Math.abs(taxable - lineTotal))}. Stock is costed at the unit price above.
                  </p>
                ) : null}
              </>
            ) : null}
          </FormSection>

          <FormSection title="Receipt" description="Photo or PDF of the bill. Kept with this purchase." icon={<ReceiptText />}>
            {receipt ? (
              <FileTile file={receipt} onRemove={dropReceipt} />
            ) : (
              <FileDropzone
                compact
                multiple={false}
                accept={ACCEPT_RECEIPTS}
                meta={{ kind: "receipt" }}
                title="Drop the receipt here or click to browse"
                hint={`Images or PDF up to ${MAX_UPLOAD_LABEL}`}
                onUploaded={(file) => {
                  setReceipt(file);
                  setValue("receiptFileId", file.id, { shouldDirty: true });
                }}
              />
            )}
          </FormSection>

          <FormSection title="Note" icon={<StickyNote />}>
            <TextareaField control={control} name="note" rows={2} placeholder="Delivery details, batch, anything worth remembering" />
          </FormSection>

          <div className="hidden border-t pt-5 lg:block">{submitBar("")}</div>
        </OperationForm>
      }
      submit={submitBar("lg:hidden")}
      context={
        item ? (
          <>
            <ItemCard item={item} />
            {after ? (
              <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
                <p className="eyebrow flex items-center gap-1.5">
                  <ArrowDownToLine className="size-3.5" /> After this purchase
                </p>
                <div className="mt-2 divide-y">
                  <ImpactRow label="Available" before={item.available} after={after.available} format={(n) => `${formatNumber(n)} ${item.unit}`} tone="good" />
                  <ImpactRow label="Average cost" before={item.unitPrice} after={after.average} format={(n) => formatCurrency(n)} />
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <StockStatusBadge status={after.status} />
                  </div>
                </div>
              </section>
            ) : (
              <ContextPlaceholder title="Enter a quantity and price">The projected stock level and average cost show up here.</ContextPlaceholder>
            )}
          </>
        ) : (
          <ContextPlaceholder title="Pick an item">Its stock level, allocation and the effect of this purchase show up here.</ContextPlaceholder>
        )
      }
    />
  );
}

function previewPurchase(item: LedgerItem, quantity: number, price: number) {
  const available = item.available + quantity;
  const average = round2((item.available * item.unitPrice + quantity * price) / available);
  return { available, average, status: getStockStatus(available, item.minStock) };
}
