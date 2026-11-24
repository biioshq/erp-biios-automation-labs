import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { listCategories } from "@/features/inventory/categories/queries";
import { CategoriesView } from "@/features/inventory/categories/components/categories-view";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "inventory.categories:view")) return <NoAccess eyebrow="Inventory" title="Categories" />;
  const { rows, uncategorized } = await listCategories();
  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Categories"
        description="Group items so lists, filters and value reports stay readable. A category can be deleted only when no item uses it."
        actions={
          can(user, "inventory.categories:create") ? (
            <Button asChild>
              <Link href="?new=1" scroll={false}>
                <Plus /> New category
              </Link>
            </Button>
          ) : null
        }
      />
      <CategoriesView rows={rows} uncategorized={uncategorized} />
    </Page>
  );
}
