import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { listRoles } from "@/features/roles/queries";
import { missingFrom } from "@/features/roles/model";
import { RoleCard, type RoleCardFlags } from "@/features/roles/components/role-card";
import { NewRoleDialog } from "@/features/roles/components/new-role-dialog";

export const metadata: Metadata = { title: "Roles and permissions" };

export default async function RolesPage() {
  const user = await requireUser();
  if (!can(user, "settings.roles:view")) return <NoAccess eyebrow="Settings" title="Roles and permissions" />;
  const roles = await listRoles();
  const canEdit = can(user, "settings.roles:edit");
  // The same rules the server applies (src/features/roles/rules.ts); here they only decide which buttons show.
  const flagsOf = (key: string, locked: boolean, builtIn: boolean, permissions: string[]): RoleCardFlags => {
    const editable = canEdit && !locked && (user.isAdmin || user.role !== key);
    return {
      editable,
      renamable: editable && !builtIn,
      deletable: editable && !builtIn,
      duplicable: canEdit && (user.isAdmin || missingFrom(user.permissions, permissions).length === 0),
    };
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Settings"
        title="Roles and permissions"
        description="Each person has one role. A role decides which pages they can open and what they can create, edit, delete, export or approve there. Changes apply on their next page load."
        actions={
          <>
            {can(user, "settings.team:view") ? (
              <Button asChild variant="outline">
                <Link href="/settings/team">
                  <Users /> Team members
                </Link>
              </Button>
            ) : null}
            {canEdit ? <NewRoleDialog roles={roles.map((r) => ({ value: r.key, label: r.name, disabled: flagsOf(r.key, r.locked, r.builtIn, r.permissions).duplicable === false }))} /> : null}
          </>
        }
      />
      {canEdit ? null : (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Your role can view roles but not change them.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => (
          <RoleCard key={r.key} role={r} flags={flagsOf(r.key, r.locked, r.builtIn, r.permissions)} isOwnRole={r.key === user.role} />
        ))}
      </div>
    </Page>
  );
}
