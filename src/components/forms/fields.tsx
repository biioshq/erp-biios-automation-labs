"use client";

import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { CalendarIcon, Check, ChevronsUpDown, Sparkles, TriangleAlert, X } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { LOW_CONFIDENCE } from "@/lib/ocr";

/**
 * Form fields for react-hook-form, built on shadcn Field. Every field takes
 * `control` + `name`, shows its error, and can carry an OCR `confidence`
 * (0–1): low-confidence values are highlighted in amber for review.
 *
 * Conventions: dates are "yyyy-mm-dd" strings (IST calendar days), amounts are numbers.
 */

type Base<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  /** OCR confidence for an auto-filled value. */
  confidence?: number | null;
};

function ConfidenceMark({ confidence }: { confidence?: number | null }) {
  if (confidence === undefined || confidence === null) return null;
  const low = confidence < LOW_CONFIDENCE;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium",
            low ? "bg-warning/15 text-warning" : "bg-success/10 text-success",
          )}
        >
          {low ? <TriangleAlert className="size-3" /> : <Sparkles className="size-3" />}
          {Math.round(confidence * 100)}%
        </span>
      </TooltipTrigger>
      <TooltipContent>{low ? "Read from the receipt with low confidence. Please check it." : "Read from the receipt."}</TooltipContent>
    </Tooltip>
  );
}

const lowConfidence = (c?: number | null) => c !== undefined && c !== null && c < LOW_CONFIDENCE;
const highlightClass = "border-warning/70 bg-warning/5 ring-2 ring-warning/20";

function FieldShell({
  label,
  required,
  confidence,
  description,
  error,
  className,
  htmlFor,
  invalid,
  children,
}: {
  label?: React.ReactNode;
  required?: boolean;
  confidence?: number | null;
  description?: React.ReactNode;
  error?: { message?: string };
  className?: string;
  htmlFor?: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Field data-invalid={invalid || undefined} className={cn("gap-1.5", className)}>
      {label ? (
        <FieldLabel htmlFor={htmlFor} className="flex w-full items-center gap-1 text-[13px]">
          <span>
            {label}
            {required ? <span className="ml-0.5 text-danger">*</span> : null}
          </span>
          <ConfidenceMark confidence={confidence} />
        </FieldLabel>
      ) : null}
      {children}
      {description && !error ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
      <FieldError errors={error ? [error] : undefined} className="text-xs" />
    </Field>
  );
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  confidence,
  placeholder,
  type = "text",
  mono,
  autoFocus,
  inputClassName,
  transform,
}: Base<T> & {
  placeholder?: string;
  type?: "text" | "email" | "password" | "tel" | "url";
  mono?: boolean;
  autoFocus?: boolean;
  inputClassName?: string;
  /** e.g. (v) => v.toUpperCase() for GSTIN */
  transform?: (value: string) => string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell
          label={label}
          required={required}
          confidence={confidence}
          description={description}
          error={fieldState.error}
          className={className}
          htmlFor={name}
          invalid={fieldState.invalid}
        >
          <Input
            {...field}
            id={name}
            type={type}
            value={(field.value as string | undefined) ?? ""}
            onChange={(e) => field.onChange(transform ? transform(e.target.value) : e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-invalid={fieldState.invalid}
            className={cn(mono && "font-mono text-[13px]", lowConfidence(confidence) && highlightClass, inputClassName)}
          />
        </FieldShell>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  confidence,
  placeholder,
  rows = 3,
}: Base<T> & { placeholder?: string; rows?: number }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell
          label={label}
          required={required}
          confidence={confidence}
          description={description}
          error={fieldState.error}
          className={className}
          htmlFor={name}
          invalid={fieldState.invalid}
        >
          <Textarea
            {...field}
            id={name}
            rows={rows}
            value={(field.value as string | undefined) ?? ""}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
            className={cn("resize-y", lowConfidence(confidence) && highlightClass)}
          />
        </FieldShell>
      )}
    />
  );
}

/** Numbers and money. Empty input → undefined. `currency` shows a ₹ prefix. */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  confidence,
  placeholder,
  currency,
  suffix,
  min,
  step,
  allowNegative,
}: Base<T> & {
  placeholder?: string;
  currency?: boolean;
  suffix?: React.ReactNode;
  min?: number;
  step?: number | "any";
  allowNegative?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = field.value as number | null | undefined;
        return (
          <FieldShell
            label={label}
            required={required}
            confidence={confidence}
            description={description}
            error={fieldState.error}
            className={className}
            htmlFor={name}
            invalid={fieldState.invalid}
          >
            <InputGroup className={cn(lowConfidence(confidence) && highlightClass)}>
              {currency ? (
                <InputGroupAddon>
                  <InputGroupText>₹</InputGroupText>
                </InputGroupAddon>
              ) : null}
              <InputGroupInput
                id={name}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                type="number"
                inputMode="decimal"
                min={allowNegative ? undefined : (min ?? 0)}
                step={step ?? (currency ? "0.01" : "any")}
                value={value === null || value === undefined || Number.isNaN(value) ? "" : value}
                onChange={(e) => {
                  const raw = e.target.value;
                  field.onChange(raw === "" ? undefined : Number(raw));
                }}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder={placeholder ?? (currency ? "0.00" : "0")}
                disabled={disabled}
                aria-invalid={fieldState.invalid}
                className="tabular"
              />
              {suffix ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{suffix}</InputGroupText>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          </FieldShell>
        );
      }}
    />
  );
}

export type Option = { value: string; label: string; description?: string; disabled?: boolean; icon?: React.ReactNode };

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  confidence,
  placeholder = "Select…",
  options,
  clearable,
}: Base<T> & { placeholder?: string; options: readonly Option[]; clearable?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell
          label={label}
          required={required}
          confidence={confidence}
          description={description}
          error={fieldState.error}
          className={className}
          htmlFor={name}
          invalid={fieldState.invalid}
        >
          <div className="flex gap-1">
            <Select
              value={(field.value as string | undefined) ?? ""}
              onValueChange={(v) => field.onChange(v)}
              disabled={disabled}
            >
              <SelectTrigger
                id={name}
                ref={field.ref}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
                className={cn("w-full", lowConfidence(confidence) && highlightClass)}
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                    {o.icon}
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clearable && field.value ? (
              <Button type="button" variant="ghost" size="icon" aria-label="Clear" onClick={() => field.onChange(undefined)}>
                <X />
              </Button>
            ) : null}
          </div>
        </FieldShell>
      )}
    />
  );
}

/** A date as "yyyy-mm-dd" (IST day), picked from a calendar. */
export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  confidence,
  placeholder = "Pick a date",
  clearable,
}: Base<T> & { placeholder?: string; clearable?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = field.value as string | undefined;
        const selected = value ? fromDateInput(value) : undefined;
        return (
          <FieldShell
            label={label}
            required={required}
            confidence={confidence}
            description={description}
            error={fieldState.error}
            className={className}
            htmlFor={name}
            invalid={fieldState.invalid}
          >
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  id={name}
                  ref={field.ref}
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-invalid={fieldState.invalid}
                  className={cn(
                    "w-full justify-start px-2.5 font-normal",
                    !value && "text-muted-foreground",
                    lowConfidence(confidence) && highlightClass,
                  )}
                >
                  <CalendarIcon className="opacity-60" />
                  {value ? formatDate(selected) : placeholder}
                  {clearable && value ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label="Clear date"
                      className="ml-auto rounded p-0.5 hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        field.onChange(undefined);
                      }}
                    >
                      <X className="size-3.5" />
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-h-(--radix-popover-content-available-height) w-auto overflow-y-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selected}
                  defaultMonth={selected}
                  captionLayout="dropdown"
                  onSelect={(d) => {
                    // The calendar hands back local midnight; keep the calendar day.
                    field.onChange(
                      d
                        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                        : undefined,
                    );
                    setOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </FieldShell>
        );
      }}
    />
  );
}

/** Searchable single select (projects, items, people, vendors). */
export function ComboboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  required,
  disabled,
  confidence,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  options,
  clearable,
  onSelected,
}: Base<T> & {
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  options: readonly Option[];
  clearable?: boolean;
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
          <FieldShell
            label={label}
            required={required}
            confidence={confidence}
            description={description}
            error={fieldState.error}
            className={className}
            htmlFor={name}
            invalid={fieldState.invalid}
          >
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
                  className={cn(
                    "w-full justify-between px-2.5 font-normal",
                    !current && "text-muted-foreground",
                    lowConfidence(confidence) && highlightClass,
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    {current?.icon}
                    {current?.label ?? placeholder}
                  </span>
                  <span className="flex items-center gap-1">
                    {clearable && current ? (
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label="Clear"
                        className="rounded p-0.5 hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          field.onChange(undefined);
                          onSelected?.(undefined);
                        }}
                      >
                        <X className="size-3.5" />
                      </span>
                    ) : null}
                    <ChevronsUpDown className="size-4 opacity-50" />
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder={searchPlaceholder} />
                  <CommandList>
                    <CommandEmpty>{emptyText}</CommandEmpty>
                    <CommandGroup>
                      {options.map((o) => (
                        <CommandItem
                          key={o.value}
                          value={`${o.label} ${o.description ?? ""} ${o.value}`}
                          disabled={o.disabled}
                          onSelect={() => {
                            field.onChange(o.value);
                            onSelected?.(o.value);
                            setOpen(false);
                          }}
                        >
                          {o.icon}
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{o.label}</span>
                            {o.description ? <span className="truncate text-xs text-muted-foreground">{o.description}</span> : null}
                          </div>
                          <Check className={cn("size-4", field.value === o.value ? "opacity-100" : "opacity-0")} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </FieldShell>
        );
      }}
    />
  );
}

/** Groups fields into a titled block inside a form ("GST details", "Payment"). */
export function FormSection({
  title,
  description,
  icon,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className={cn("space-y-4 rounded-xl border bg-surface/40 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {icon ? <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
          <div>
            <legend className="text-sm font-semibold">{title}</legend>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </fieldset>
  );
}

export { toDateInput };
