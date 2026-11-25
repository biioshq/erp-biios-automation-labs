import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { listTeamWithWorkload } from "@/features/team/queries";
import { listRoles } from "@/features/roles/queries";
import { missingFrom } from "@/features/roles/model";
import { TeamList, type TeamListRow } from "@/features/team/components/team-list";
import { AddMemberDialog } from "@/features/team/components/add-member-dialog";
import type { RoleOption } from "@/features/team/types";
import { ADMIN_ROLE } from "@/lib/permissions";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Team members" };

export default async function TeamPage() {
  const user = await requireUser();
  if (!can(user, "settings.team:view")) return <NoAccess eyebrow="Settings" title="Team members" />;
  const [members, roles] = await Promise.all([listTeamWithWorkload(), listRoles()]);

  const canCreate = can(user, "settings.team:create");
  const canEdit = can(user, "settings.team:edit");
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  // Within the actor's own role: the same rule the server applies (src/features/team/rules.ts).
  const withinOwnRole = (key: string) => {
    if (user.isAdmin) return true;
    const role = roleByKey.get(key);
    return Boolean(role && key !== ADMIN_ROLE && missingFrom(user.permissions, role.permissions).length === 0);
  };
  const roleOptions: RoleOption[] = roles.map((r) => ({
    value: r.key,
    label: r.name,
    disabled: !withinOwnRole(r.key),
  }));

  const rows: TeamListRow[] = members.map((m) => {
    const role = roleByKey.get(m.role);
    const manageable = canEdit && m.id !== user.id && withinOwnRole(m.role);
    return {
      ...m,
      roleName: role?.name ?? "Role missing",
      roleMissing: !role,
      isSelf: m.id === user.id,
      canRename: canEdit && (user.isAdmin || m.role !== ADMIN_ROLE || m.id === user.id),
      canChangeRole: manageable,
      // Setting someone's password is for admins only, whatever their role allows.
      canSetPassword: user.isAdmin && m.id !== user.id,
    };
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Settings"
        title="Team members"
        description={
          <>
            <span className="tabular">{formatNumber(members.length)}</span> {members.length === 1 ? "person" : "people"} can sign in and be
            assigned tasks.
          </>
        }
        actions={
          <>
            {can(user, "settings.roles:view") ? (
              <Button asChild variant="outline">
                <Link href="/settings/roles">
                  <ShieldCheck /> Roles and permissions
                </Link>
              </Button>
            ) : null}
            {canCreate ? <AddMemberDialog roles={roleOptions} /> : null}
          </>
        }
      />
      <TeamList members={rows} roles={roleOptions} canManage={canCreate || canEdit} />
    </Page>
  );
}
