"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NumberField, TextareaField } from "@/components/forms/fields";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { applyFieldErrors } from "@/lib/action-result";
import { INVENTORY_UNITS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import { adjustItemStock } from "../actions";
import { adjustFormSchema, type AdjustFormInput, type AdjustFormValues } from "../schemas";
import type { ItemDetail } from "../types";
import { formValidation } from "@/components/forms/form-options";

/**
 * Manual correction of available stock (count differences, damage, found stock).
 * Recorded as an adjustment movement with the reason.
 */
export function AdjustStockDialog({
  item,
  open,
  onOpenChange,
  onDone,
}: {
  item: Pick<ItemDetail, "id" | "name" | "unit" | "available" | "minStock">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<AdjustFormInput, unknown, AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    defaultValues: { direction: "add", quantity: undefined, reason: "" },
    ...formValidation,
  });
  const { control, setValue } = form;
  const direction = useWatch({ control, name: "direction" });
  const quantity = useWatch({ control, name: "quantity" });
  const unit = labelOf(INVENTORY_UNITS, item.unit).toLowerCase();

  const delta = (direction === "remove" ? -1 : 1) * (quantity && quantity > 0 ? quantity : 0);
  const after = item.available + delta;
  const invalidRemoval = after < 0;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await adjustItemStock({
        id: item.id,
        delta: values.direction === "remove" ? -values.quantity : values.quantity,
        reason: values.reason,
      });
      if (!result.ok) {
        // The ledger reports quantity problems under "delta"; the form calls it quantity.
        const fieldErrors = result.fieldErrors ? { ...result.fieldErrors, quantity: result.fieldErrors.delta ?? result.fieldErrors.quantity } : undefined;
        applyFieldErrors({ ...result, fieldErrors }, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`Stock adjusted. ${item.name} now has ${formatNumber(result.data.available)} ${unit}.`);
      emitDataChanged();
      form.reset({ direction: "add", quantity: undefined, reason: "" });
      onOpenChange(false);
      onDone?.();
    });
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              Correct the available quantity of {item.name}. Use Purchase, Assign or Return for normal stock movement. An
              adjustment does not add or remove expenses.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <ToggleGroup
              type="single"
              variant="outline"
              value={direction}
              onValueChange={(v) => v && setValue("direction", v as "add" | "remove")}
              className="w-full"
              aria-label="Direction"
            >
              <ToggleGroupItem value="add" className="flex-1">
                <Plus /> Add stock
              </ToggleGroupItem>
              <ToggleGroupItem value="remove" className="flex-1">
                <Minus /> Remove stock
              </ToggleGroupItem>
            </ToggleGroup>

            <NumberField control={control} name="quantity" label="Quantity" required suffix={unit} />
            <TextareaField
              control={control}
              name="reason"
              label="Reason"
              required
              rows={2}
              placeholder="Cycle count found 4 extra, damaged in transit, …"
            />

            <div className="flex items-center justify-between rounded-lg border bg-surface/40 px-3.5 py-3 text-sm">
              <span className="text-muted-foreground">Available after</span>
              <span className="flex items-center gap-2">
                <span className="tabular font-semibold">{invalidRemoval ? "Not enough stock" : `${formatNumber(after)} ${unit}`}</span>
                {!invalidRemoval ? <StockStatusBadge status={getStockStatus(after, item.minStock)} /> : null}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || invalidRemoval}>
              {pending ? <Spinner /> : null}
              Record adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
