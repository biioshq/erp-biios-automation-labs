import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { getRole } from "@/features/roles/queries";
import { PermissionMatrix } from "@/features/roles/components/permission-matrix";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Role permissions" };

export default async function RolePage({ params }: { params: Promise<{ key: string }> }) {
  const user = await requireUser();
  if (!can(user, "settings.roles:view")) return <NoAccess eyebrow="Settings" title="Role permissions" />;
  const { key } = await params;
  const role = await getRole(decodeURIComponent(key));
  if (!role) notFound();

  const ownRole = !user.isAdmin && user.role === role.key;
  const editable = can(user, "settings.roles:edit") && !role.locked && !ownRole;
  const note = role.locked
    ? "Admin always has every permission and cannot be changed."
    : ownRole
      ? "This is your own role, so you cannot change it. Ask an admin."
      : !editable
        ? "Your role can view this role but not change it."
        : user.isAdmin
          ? null
          : "You can give only permissions your own role has; the others are greyed out.";

  return (
    <Page>
      <PageHeader
        eyebrow="Settings · Roles"
        title={role.name}
        description={
          <>
            {role.description ? `${role.description} ` : null}
            <span className="tabular">{formatNumber(role.people.length)}</span> {role.people.length === 1 ? "person has" : "people have"} this
            role. Changes apply on their next page load.
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/roles">
              <ArrowLeft /> All roles
            </Link>
          </Button>
        }
      />
      {note ? <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{note}</p> : null}
      <PermissionMatrix
        // A fresh matrix after each save or reset, starting from what the server stored.
        key={role.permissions.join(",")}
        roleKey={role.key}
        initial={role.permissions}
        editable={editable}
        grantable={user.isAdmin ? null : user.permissions}
        canReset={editable && role.key === "member" && !role.isDefault}
      />
    </Page>
  );
}
