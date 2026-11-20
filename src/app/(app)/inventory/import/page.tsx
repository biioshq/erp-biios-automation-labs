import type { Metadata } from "next";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/server/auth/session";
import { driveConfigured } from "@/server/google-drive";
import { CsvImport } from "@/features/imports/csv/components/csv-import";
import { DrivePhotosImport } from "@/features/imports/drive/components/drive-photos-import";

// Import batches (CSV rows, Drive downloads, receipt reading) run as this page's server actions.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Import items" };

export default async function InventoryImportPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Import"
        description="Add many items at once from a CSV or Excel file, and attach item photos from a Google Drive folder. Nothing is saved until you review it."
      />
      {user.role !== "admin" ? (
        <EmptyState title="Only admins can import" description="Ask an admin to import the file for you." />
      ) : (
        <div className="space-y-6">
          <Section title="Items from a CSV or Excel file" description="One item per row, including parts lists (BOM): every column is kept, as a field or as a detail on the item. Items that already exist get the new stock added instead of a duplicate.">
            <CsvImport kinds={["items"]} />
          </Section>
          <Section title="Item photos from Google Drive" description="Images named after an item's SKU or name become that item's photo.">
            <DrivePhotosImport configured={driveConfigured()} />
          </Section>
        </div>
      )}
    </Page>
  );
}
