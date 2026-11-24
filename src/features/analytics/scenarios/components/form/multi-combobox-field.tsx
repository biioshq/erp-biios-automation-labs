"use client";

import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Option } from "@/components/forms/fields";
import { cn } from "@/lib/utils";

/** Searchable multi select (projects, equipment). The value is a list of ids; picked ones show as removable chips. */
export function MultiComboboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder = "Select…",
  emptyText = "Nothing found.",
  options,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label?: React.ReactNode;
  description?: React.ReactNode;
  placeholder?: string;
  emptyText?: string;
  options: readonly Option[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = ((field.value as string[] | undefined) ?? []).filter(Boolean);
        const picked = value.map((v) => options.find((o) => o.value === v) ?? { value: v, label: "Removed record" });
        const toggle = (v: string) => field.onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
        return (
          <Field data-invalid={fieldState.invalid || undefined} className={cn("gap-1.5", className)}>
            {label ? (
              <FieldLabel htmlFor={name} className="text-[13px]">
                {label}
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
                  aria-invalid={fieldState.invalid}
                  className={cn("w-full justify-between px-2.5 font-normal", !value.length && "text-muted-foreground")}
                >
                  <span className="truncate">{value.length ? `${value.length} selected` : placeholder}</span>
                  <ChevronsUpDown className="size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search…" />
                  <CommandList>
                    <CommandEmpty>{emptyText}</CommandEmpty>
                    <CommandGroup>
                      {options.map((o) => (
                        <CommandItem key={o.value} value={`${o.label} ${o.description ?? ""} ${o.value}`} disabled={o.disabled} onSelect={() => toggle(o.value)}>
                          {o.icon}
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{o.label}</span>
                            {o.description ? <span className="truncate text-xs text-muted-foreground">{o.description}</span> : null}
                          </div>
                          <Check className={cn("size-4", value.includes(o.value) ? "opacity-100" : "opacity-0")} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {picked.length ? (
              <div className="flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <span key={p.value} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs">
                    <span className="truncate">{p.label}</span>
                    <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={`Remove ${p.label}`} onClick={() => toggle(p.value)}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {description && !fieldState.error ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
          </Field>
        );
      }}
    />
  );
}
