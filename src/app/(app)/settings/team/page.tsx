import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/shared/page";
import { requireUser } from "@/server/auth/session";
import { listTeamWithWorkload } from "@/features/team/queries";
import { TeamList } from "@/features/team/components/team-list";
import { AddMemberDialog } from "@/features/team/components/add-member-dialog";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Team members" };

export default async function TeamPage() {
  const user = await requireUser();
  const members = await listTeamWithWorkload();
  const isAdmin = user.role === "admin";
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
        actions={isAdmin ? <AddMemberDialog /> : undefined}
      />
      <TeamList members={members} isAdmin={isAdmin} />
    </Page>
  );
}
