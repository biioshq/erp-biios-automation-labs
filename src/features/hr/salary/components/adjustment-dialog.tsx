"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NumberField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, round2 } from "@/lib/format";
import { money } from "@/lib/zod";
import { adjustmentSchema } from "../../schemas";
import { saveAdjustment } from "../actions";
import { monthLabel, type SalaryRow } from "../types";

/** The shared schema with empty amounts allowed in the form; they are sent as 0. */
const formSchema = adjustmentSchema.extend({ additions: money.optional(), deductions: money.optional() });
type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;

/** Bonus, deductions and a note for one person and month. Saving all empty clears them. */
export function AdjustmentDialog({ row, open, onOpenChange }: { row: SalaryRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      employeeId: row.employeeId,
      month: row.month,
      additions: row.additions || undefined,
      deductions: row.deductions || undefined,
      note: row.adjustmentNote ?? "",
    },
    ...formValidation,
  });
  const { control, setError } = form;
  const [additions, deductions] = useWatch({ control, name: ["additions", "deductions"] });
  const before = round2(row.earned + row.overtimePay);
  const after = Math.max(0, round2(before + (Number(additions) || 0) - (Number(deductions) || 0)));

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveAdjustment({ ...values, additions: values.additions ?? 0, deductions: values.deductions ?? 0 });
      if (!result.ok) {
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.cleared ? "Adjustment cleared" : (result.message ?? "Adjustment saved"));
      emitDataChanged();
      onOpenChange(false);
    }),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Adjust salary</DialogTitle>
            <DialogDescription>
              {row.name} for {monthLabel(row.month)}. Earned from attendance, with overtime:{" "}
              <span className="tabular font-medium text-foreground">{formatCurrency(before)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="additions" label="Bonus" currency description="Added to the salary." />
            <NumberField control={control} name="deductions" label="Deductions" currency description="Advances, fines and the like." />
            <TextareaField control={control} name="note" label="Note" placeholder="What the bonus or deduction is for" rows={2} className="sm:col-span-2" />
          </div>
          <p className="text-sm">
            Net after this: <span className="tabular font-semibold">{formatCurrency(after)}</span>
          </p>
          <p className="text-xs text-muted-foreground">This changes the salary on this page only. Expenses do not change.</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
