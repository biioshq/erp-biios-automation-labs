"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Control, FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Eye, FileText, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TextField, TextareaField } from "@/components/forms/fields";
import { Section } from "@/components/shared/page";
import { emitDataChanged } from "@/lib/events";
import { createScenario, previewScenario, updateScenario } from "../../actions";
import type { ScenarioFormValues } from "../../schemas";
import type { ScenarioResults } from "../../types";
import { ResultsView } from "../results-view";

/**
 * What every scenario form shares: name, description and assumptions, the Preview / Save buttons
 * and the preview of results under the form. Results are always worked out on the server.
 */
export function ScenarioFormShell<TIn extends FieldValues, TOut extends ScenarioFormValues>({
  form,
  scenarioId,
  version,
  children,
}: {
  form: UseFormReturn<TIn, unknown, TOut>;
  /** Set when editing. */
  scenarioId?: string;
  /** When the edited scenario was last saved (ISO). */
  version?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"preview" | "draft" | "saved" | null>(null);
  const [preview, setPreview] = useState<ScenarioResults | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const field = (name: string) => name as FieldPath<TIn>;
  // The meta fields read raw values only, so the control is used without its transformed type.
  const control = form.control as unknown as Control<TIn>;

  const run = (kind: "preview" | "draft" | "saved") =>
    form.handleSubmit(
      (values) => {
        setBusy(kind);
        startTransition(async () => {
          if (kind === "preview") {
            const result = await previewScenario(values);
            setBusy(null);
            if (!result.ok) return void toast.error(result.error);
            setPreview(result.data);
            requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            return;
          }
          const result = scenarioId ? await updateScenario({ id: scenarioId, form: values, updatedAt: version }) : await createScenario({ form: values, status: kind });
          if (!result.ok) {
            setBusy(null);
            return void toast.error(result.error);
          }
          toast.success(result.message ?? "Saved");
          emitDataChanged();
          router.push(`/analytics/scenarios/${result.data.id}`);
        });
      },
      () => toast.error("Some fields need attention."),
    )();

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-5 sm:gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run("saved");
      }}
    >
      <Section title="About this scenario" description="A name people will recognise, and what you are assuming. Nothing here changes real records.">
        <div className="grid gap-4">
          <TextField control={control} name={field("name")} label="Name" required placeholder="Demand +20% on Hinjewadi" />
          <div className="grid gap-4 md:grid-cols-2">
            <TextareaField control={control} name={field("description")} label="Description" placeholder="What this scenario explores" />
            <TextareaField control={control} name={field("assumptions")} label="Assumptions" placeholder="What you take as given, e.g. prices stay as they are" />
          </div>
        </div>
      </Section>

      {children}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
        <Button type="button" variant="ghost" asChild>
          <Link href={scenarioId ? `/analytics/scenarios/${scenarioId}` : "/analytics/scenarios"}>Cancel</Link>
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => run("preview")}>
          {busy === "preview" ? <Spinner /> : <Eye />} Preview results
        </Button>
        {scenarioId ? null : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run("draft")}>
            {busy === "draft" ? <Spinner /> : <FileText />} Save as draft
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {busy === "saved" ? <Spinner /> : <Save />} {scenarioId ? "Save changes" : "Save scenario"}
        </Button>
      </div>

      <div ref={previewRef} className="scroll-mt-4">
        {preview ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Preview</h2>
              <p className="text-sm text-muted-foreground">Worked out from today&apos;s records. Saving keeps these figures with the scenario.</p>
            </div>
            <ResultsView results={preview} />
          </div>
        ) : null}
      </div>
    </form>
  );
}
