import type { Metadata } from "next";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/server/auth/session";
import { driveConfigured } from "@/server/google-drive";
import { CsvImport } from "@/features/imports/csv/components/csv-import";
import { DriveReceiptsImport } from "@/features/imports/drive/components/drive-receipts-import";

// Import batches (CSV rows, Drive downloads, receipt reading) run as this page's server actions.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Import" };

export default async function FinanceImportPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Import"
        description="Add many expenses or income records from a CSV or Excel file, or turn a Google Drive folder of bills into draft expenses. Nothing is saved until you review it."
      />
      {user.role !== "admin" ? (
        <EmptyState title="Only admins can import" description="Ask an admin to import the file for you." />
      ) : (
        <div className="space-y-6">
          <Section title="From a CSV or Excel file" description="Expenses or income, one row each. Download a template to see the columns.">
            <CsvImport kinds={["expenses", "income"]} />
          </Section>
          <Section title="Bills from Google Drive" description="Every image or PDF in a shared folder is read and becomes a draft expense to check and save.">
            <DriveReceiptsImport configured={driveConfigured()} />
          </Section>
        </div>
      )}
    </Page>
  );
}
