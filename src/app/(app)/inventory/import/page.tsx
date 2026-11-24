import type { Metadata } from "next";
import { Info } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { driveConfigured } from "@/server/google-drive";
import { CsvImport } from "@/features/imports/csv/components/csv-import";
import { DrivePhotosImport } from "@/features/imports/drive/components/drive-photos-import";

// Import batches (CSV rows, Drive downloads, receipt reading) run as this page's server actions.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Import items" };

export default async function InventoryImportPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "inventory.import:view")) return <NoAccess eyebrow="Inventory" title="Import" />;
  const drive = driveConfigured();
  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Import"
        description="Add many items at once from a CSV or Excel file, and attach item photos from a Google Drive folder. Nothing is saved until you review it."
      />
      {!can(user, "inventory.import:create") ? (
        <EmptyState title="You do not have permission to import" description="Ask an admin to import the file for you." />
      ) : (
        <div className="space-y-6">
          <Section title="Items from a CSV or Excel file" description="One item per row, including parts lists (BOM): every column is kept, as a field or as a detail on the item. Items that already exist get the new stock added instead of a duplicate.">
            <CsvImport kinds={["items"]} />
          </Section>
          <Section title="Item photos from Google Drive" description="Images named after an item's SKU or name become that item's photo.">
            {/* The setup steps are for admins; everyone else gets one line until Drive import is switched on. */}
            {drive || user.isAdmin ? (
              <DrivePhotosImport configured={drive} />
            ) : (
              <p className="flex items-center gap-2 rounded-xl border bg-surface/40 p-4 text-sm text-muted-foreground">
                <Info className="size-4 shrink-0" /> Google Drive photo import is not switched on. Ask your administrator.
              </p>
            )}
          </Section>
        </div>
      )}
    </Page>
  );
}
