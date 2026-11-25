import Link from "next/link";
import { Info, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatNumber, initials } from "@/lib/format";
import type { RoleOption, TeamRow } from "../types";
import { MemberActions } from "./member-actions";

/** A team row with its role name and what the viewer may change (the server checks again). */
export type TeamListRow = TeamRow & {
  roleName: string;
  /** The person's role key has no role (it was deleted): they have no access until given one. */
  roleMissing: boolean;
  isSelf: boolean;
  canRename: boolean;
  canChangeRole: boolean;
  canSetPassword: boolean;
};

function RoleBadge({ m }: { m: TeamListRow }) {
  return (
    <StatusBadge tone={m.roleMissing ? "warning" : m.role === "admin" ? "brand" : "neutral"}>
      {m.roleName}
    </StatusBadge>
  );
}

/**
 * The team. Everyone with "settings.team:view" sees it; people who may edit get a menu on each row
 * (change role, edit name, and for admins only, set a new password).
 */
export function TeamList({ members, roles, canManage }: { members: TeamListRow[]; roles: RoleOption[]; canManage: boolean }) {
  return (
    <div className="space-y-4">
      {canManage ? null : (
        <Alert>
          <Info />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>Your role can view the team but not change it. Ask an admin if someone is missing.</AlertDescription>
        </Alert>
      )}
      {members.length === 0 ? (
        <EmptyState icon={Users} title="No team members yet" description="Add the first member so tasks can be assigned." />
      ) : (
        <>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-card md:hidden">
          {members.map((m) => (
            <li key={m.id} className="space-y-3 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Avatar>
                  {m.image ? <AvatarImage src={m.image} alt="" /> : null}
                  <AvatarFallback className="bg-brand/15 font-semibold text-brand-ink">{initials(m.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <RoleBadge m={m} />
                <MemberActions member={m} roles={roles} />
              </div>
              {m.openTasks ? (
                <Link
                  href={`/tasks/all?assignee=${m.id}&status=pending,in_progress,review`}
                  className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 text-sm active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="text-muted-foreground">Open tasks</span>
                  <span className="tabular font-medium">
                    {formatNumber(m.openTasks)}
                    {m.overdueTasks ? <span className="ml-2 text-xs font-normal text-danger">{formatNumber(m.overdueTasks)} overdue</span> : null}
                  </span>
                </Link>
              ) : (
                <p className="flex min-h-10 items-center justify-between rounded-lg bg-muted/50 px-3 text-sm text-muted-foreground">
                  <span>Open tasks</span>
                  <span className="tabular">0</span>
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-hidden rounded-xl border bg-card shadow-card md:block">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40 [&_tr]:border-b">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-10 pl-4 text-xs">Member</TableHead>
                  <TableHead className="h-10 text-xs">Email</TableHead>
                  <TableHead className="h-10 text-xs">Role</TableHead>
                  <TableHead className="h-10 text-right text-xs">Open tasks</TableHead>
                  <TableHead className="h-10 w-12 pr-4 text-right text-xs">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="py-3 pl-4">
                      <div className="flex min-w-44 items-center gap-3">
                        <Avatar>
                          {m.image ? <AvatarImage src={m.image} alt="" /> : null}
                          <AvatarFallback className="bg-brand/15 font-semibold text-brand-ink">{initials(m.name)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">{m.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <RoleBadge m={m} />
                    </TableCell>
                    <TableCell className="text-right">
                      {m.openTasks ? (
                        <Link
                          href={`/tasks/all?assignee=${m.id}&status=pending,in_progress,review`}
                          className="tabular font-medium hover:underline"
                        >
                          {formatNumber(m.openTasks)}
                          {m.overdueTasks ? <span className="ml-2 text-xs font-normal text-danger">{formatNumber(m.overdueTasks)} overdue</span> : null}
                        </Link>
                      ) : (
                        <span className="tabular text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <MemberActions member={m} roles={roles} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
