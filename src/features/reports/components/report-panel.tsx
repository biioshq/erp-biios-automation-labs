import { Suspense } from "react";
import { PreviewSkeleton } from "./preview-skeleton";
import { Section } from "@/components/shared/page";
import type { ReportType } from "@/lib/constants";
import { getReportPreview } from "../queries";
import type { ReportFilters } from "../types";
import { DownloadButtons } from "./download-buttons";
import { ReportPreviewView } from "./report-preview";

async function PreviewBody({ type, filters }: { type: ReportType; filters: ReportFilters }) {
  const preview = await getReportPreview(type, filters);
  return (
    <div className="space-y-4">
      {preview.subtitle ? <p className="text-[13px] text-muted-foreground">{preview.subtitle}</p> : null}
      <ReportPreviewView preview={preview} />
    </div>
  );
}

/**
 * A report's filter bar, downloads and preview. The preview streams in behind a
 * skeleton, so changing a filter never blocks the controls.
 */
export function ReportPanel({
  type,
  title,
  filters,
  controls,
}: {
  type: ReportType;
  title: string;
  filters: ReportFilters;
  controls: React.ReactNode;
}) {
  const key = JSON.stringify([type, filters]);
  return (
    <Section
      title={title}
      description="Preview of the first 50 rows. Downloads contain every row."
      actions={<DownloadButtons type={type} filters={filters} />}
    >
      <div className="space-y-5">
        {controls}
        <Suspense key={key} fallback={<PreviewSkeleton />}>
          <PreviewBody type={type} filters={filters} />
        </Suspense>
      </div>
    </Section>
  );
}
