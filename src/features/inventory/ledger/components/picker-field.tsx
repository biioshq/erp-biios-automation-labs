"use client";

import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type PickerOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
};

/**
 * Searchable single select like ComboboxField, with a trailing slot per
 * option (stock status badges) so unavailable choices can say why.
 */
export function PickerField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  options,
  onSelected,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  options: readonly PickerOption[];
  onSelected?: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const current = options.find((o) => o.value === field.value);
        return (
          <Field data-invalid={fieldState.invalid || undefined} className={cn("gap-1.5", className)}>
            {label ? (
              <FieldLabel htmlFor={name} className="text-[13px]">
                {/* One span, as in src/components/forms/fields.tsx, so the label's flex gap does not push the asterisk away. */}
                <span>
                  {label}
                  {required ? <span className="ml-0.5 text-danger">*</span> : null}
                </span>
              </FieldLabel>
            ) : null}
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  id={name}
                  ref={field.ref}
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  disabled={disabled}
                  aria-invalid={fieldState.invalid}
                  className={cn("h-auto min-h-10 w-full md:min-h-9 justify-between px-2.5 py-1.5 font-normal", !current && "text-muted-foreground")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {current?.leading}
                    <span className="min-w-0 truncate text-left">{current?.label ?? placeholder}</span>
                    {current?.description ? (
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">{current.description}</span>
                    ) : null}
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[min(18rem,calc(100vw-2rem))] p-0" align="start">
                <Command>
                  <CommandInput placeholder={searchPlaceholder} />
                  <CommandList>
                    <CommandEmpty>{emptyText}</CommandEmpty>
                    <CommandGroup>
                      {options.map((o) => (
                        <CommandItem
                          key={o.value}
                          className="min-h-11 md:min-h-0"
                          value={`${o.label} ${o.description ?? ""} ${o.value}`}
                          disabled={o.disabled}
                          onSelect={() => {
                            field.onChange(o.value);
                            onSelected?.(o.value);
                            setOpen(false);
                          }}
                        >
                          {o.leading}
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{o.label}</span>
                            {o.description ? <span className="truncate text-xs text-muted-foreground">{o.description}</span> : null}
                          </div>
                          {o.trailing}
                          <Check className={cn("size-4 shrink-0", field.value === o.value ? "opacity-100" : "opacity-0")} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {description && !fieldState.error ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
          </Field>
        );
      }}
    />
  );
}

export function ClearButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
      <X />
    </Button>
  );
}
