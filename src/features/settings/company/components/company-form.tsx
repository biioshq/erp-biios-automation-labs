"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Banknote, Building2, FileSignature, FileText, Info, MapPin, Phone, Save, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormSection, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { saveCompanyProfile } from "../actions";
import { companyProfileSchema, type CompanyDetails, type CompanyProfileInput, type CompanyProfileValues } from "../schemas";

/**
 * The business details form. Read only without `canEdit` (the server checks again on save).
 * Empty fields are left off invoices, receipts and statements.
 */
export function CompanyForm({ details, canEdit, configuredStateCode }: { details: CompanyDetails; canEdit: boolean; configuredStateCode: string }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<CompanyProfileInput, unknown, CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: details,
    ...formValidation,
  });
  const { control, formState } = form;
  const gstinValue = useWatch({ control, name: "gstin" });
  const gstinState = typeof gstinValue === "string" && gstinValue.length >= 2 ? gstinValue.slice(0, 2) : null;

  const submit = form.handleSubmit((values) => {
    if (!canEdit) return;
    startTransition(async () => {
      const result = await saveCompanyProfile(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      form.reset(form.getValues());
      toast.success(result.message ?? "Business details saved");
      emitDataChanged();
    });
  });

  const upper = (v: string) => v.toUpperCase();

  return (
    <form onSubmit={submit} noValidate className="min-w-0 space-y-5" aria-label="Business details">
      <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
        <FormSection title="Business" icon={<Building2 />} description="The name that heads every document. Leave the legal name empty to use the app's name.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="legalName" label="Legal name" placeholder="As registered" />
            <TextField control={control} name="tradeName" label="Trade name" description="Printed under the legal name when different." />
          </div>
        </FormSection>

        <FormSection title="Address" icon={<MapPin />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="addressLine1" label="Address line 1" className="sm:col-span-2" />
            <TextField control={control} name="addressLine2" label="Address line 2" className="sm:col-span-2" />
            <TextField control={control} name="city" label="City" />
            <TextField control={control} name="state" label="State" />
            <TextField control={control} name="stateCode" label="State code" mono placeholder="27" description="The two-digit GST state code." />
            <TextField control={control} name="pin" label="PIN code" mono />
          </div>
        </FormSection>

        <FormSection title="Registrations" icon={<ScrollText />} description="A document is titled Tax invoice only when a GSTIN is saved here and the invoice carries GST.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="gstin" label="GSTIN" mono transform={upper} placeholder="27AAPFU0939F1ZV" />
            <TextField control={control} name="pan" label="PAN" mono transform={upper} />
            <TextField control={control} name="cin" label="CIN or LLPIN" mono transform={upper} className="sm:col-span-2" />
          </div>
          {gstinState && /^\d{2}$/.test(gstinState) && gstinState !== configuredStateCode ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                This GSTIN starts with {gstinState}, but the app splits GST into CGST and SGST or IGST using state code {configuredStateCode} (set in the
                server settings). Saving here does not change that. Ask whoever runs the server if it needs to change.
              </span>
            </p>
          ) : null}
        </FormSection>

        <FormSection title="Contact" icon={<Phone />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="phone" label="Phone" type="tel" />
            <TextField control={control} name="email" label="Email" type="email" />
            <TextField control={control} name="website" label="Website" className="sm:col-span-2" placeholder="www.example.com" />
          </div>
        </FormSection>

        <FormSection title="Bank and UPI" icon={<Banknote />} description="Printed on invoices so customers know where to pay.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="bankName" label="Bank" />
            <TextField control={control} name="accountName" label="Account name" />
            <TextField control={control} name="accountNumber" label="Account number" mono />
            <TextField control={control} name="ifsc" label="IFSC" mono transform={upper} />
            <TextField control={control} name="branch" label="Branch" />
            <TextField control={control} name="upiId" label="UPI ID" mono placeholder="name@bank" />
          </div>
        </FormSection>

        <FormSection title="Invoice text" icon={<FileText />}>
          <div className="grid gap-4">
            <TextareaField control={control} name="invoiceTerms" label="Terms" rows={4} description="Printed on invoices, for example payment terms." />
            <TextField control={control} name="footerNote" label="Footer note" description="One line at the bottom of every page of a document." />
          </div>
        </FormSection>

        <FormSection title="Signatory" icon={<FileSignature />} description="Printed under 'Authorised signatory'.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="signatoryName" label="Name" />
            <TextField control={control} name="signatoryTitle" label="Title" placeholder="Director" />
          </div>
        </FormSection>
      </fieldset>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t bg-background/90 px-1 py-3 backdrop-blur">
          <Button type="submit" disabled={pending || !formState.isDirty}>
            {pending ? <Spinner /> : <Save />} Save details
          </Button>
        </div>
      ) : null}
    </form>
  );
}
