import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { listCategories } from "@/features/inventory/categories/queries";
import { CategoriesView } from "@/features/inventory/categories/components/categories-view";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const { rows, uncategorized } = await listCategories();
  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Categories"
        description="Group items so lists, filters and value reports stay readable. A category can be deleted only when no item uses it."
        actions={
          <Button asChild>
            <Link href="?new=1" scroll={false}>
              <Plus /> New category
            </Link>
          </Button>
        }
      />
      <CategoriesView rows={rows} uncategorized={uncategorized} />
    </Page>
  );
}
