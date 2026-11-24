"use client";

import { useCan } from "@/components/current-user";

/**
 * Shows its children only to people with the permission. It only hides controls: the server
 * actions check the same permission.
 */
export function IfCan({ permission, children }: { permission: string; children: React.ReactNode }) {
  return useCan(permission) ? <>{children}</> : null;
}
