"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TextField, TextareaField } from "@/components/forms/fields";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { cn } from "@/lib/utils";
import { createCategory, updateCategory } from "../actions";
import { CATEGORY_COLORS, categoryFormSchema, type CategoryFormInput, type CategoryFormValues } from "../schemas";
import type { CategoryRow } from "../types";
import { formValidation } from "@/components/forms/form-options";

/** Create or edit a category. */
export function CategoryDialog({
  open,
  category,
  onOpenChange,
}: {
  open: boolean;
  category: CategoryRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(category);
  const [pending, startTransition] = useTransition();
  const form = useForm<CategoryFormInput, unknown, CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: category?.name ?? "",
      description: category?.description ?? "",
      color: category?.color ?? CATEGORY_COLORS[0],
    },
    ...formValidation,
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = isEdit && category ? await updateCategory({ ...values, id: category.id }) : await createCategory(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? (isEdit ? "Category updated" : "Category added"));
      emitDataChanged();
      onOpenChange(false);
    });
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>Categories group items in lists, filters and the value chart.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField control={form.control} name="name" label="Name" required autoFocus placeholder="Electronics" />
            <TextareaField control={form.control} name="description" label="Description" rows={2} placeholder="What belongs here" />
            <Controller
              control={form.control}
              name="color"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
                  <FieldLabel className="text-[13px]">Colour</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Category colour">
                    {CATEGORY_COLORS.map((c) => {
                      const selected = field.value?.toLowerCase() === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={`Colour ${c}`}
                          onClick={() => field.onChange(c)}
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            selected && "ring-2 ring-foreground/70",
                          )}
                          style={{ background: c }}
                        >
                          {selected ? <Check className="size-3.5 text-white" /> : null}
                        </button>
                      );
                    })}
                    <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
                      Custom
                      <input
                        type="color"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="size-7 cursor-pointer rounded-md border bg-transparent p-0.5"
                        aria-label="Custom colour"
                      />
                    </label>
                  </div>
                  <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
                </Field>
              )}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {isEdit ? "Save changes" : "Add category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
