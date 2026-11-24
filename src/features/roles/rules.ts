import "server-only";

import { AppError } from "@/server/errors";
import type { SessionUser } from "@/server/auth/session";
import { ADMIN_ROLE } from "@/lib/permissions";
import { missingFrom, permissionLabel } from "./model";

/**
 * Who may edit a role. Admins may edit every role but Admin. Anyone else with "settings.roles:edit"
 * may not edit the role they hold, and may not grant a permission their own role lacks.
 */
export function assertMayEditRole(actor: SessionUser, key: string) {
  if (key === ADMIN_ROLE) throw new AppError("The Admin role always has every permission and cannot be changed.", "forbidden");
  if (!actor.isAdmin && actor.role === key) {
    throw new AppError("You cannot change the role you hold yourself. Ask an admin.", "forbidden");
  }
}

/** Refuses when `added` holds a permission the actor does not have (admins have them all). */
export function assertMayGrant(actor: SessionUser, added: readonly string[]) {
  if (actor.isAdmin) return;
  const missing = missingFrom(actor.permissions, added);
  if (missing.length) {
    throw new AppError(
      `You can only give permissions your own role has. Not in your role: ${missing.slice(0, 5).map(permissionLabel).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}.`,
      "forbidden",
    );
  }
}
