"use client";

import { createContext, useContext, useMemo } from "react";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** The role key: "admin", "member" or a custom role's key. */
  role: string;
  roleName: string;
  /** The built-in Admin role. Only for protecting admin accounts; gate features with useCan. */
  isAdmin: boolean;
  permissions: string[];
};

type Value = { user: CurrentUser; granted: ReadonlySet<string> };

const CurrentUserContext = createContext<Value | null>(null);

/**
 * Provided by the app layout with the permissions read on the server for this request.
 * Server pages, actions and route handlers still enforce them; this only hides controls.
 */
export function CurrentUserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const value = useMemo<Value>(() => ({ user, granted: new Set(user.permissions) }), [user]);
  return <CurrentUserContext value={value}>{children}</CurrentUserContext>;
}

export function useCurrentUser(): CurrentUser {
  const value = useContext(CurrentUserContext);
  if (!value) throw new Error("useCurrentUser must be used inside the app layout");
  return value.user;
}

/** True when the signed-in person's role includes the permission (for example "finance.expenses:create"). */
export function useCan(permission: string): boolean {
  const value = useContext(CurrentUserContext);
  if (!value) return false;
  return value.user.isAdmin || value.granted.has(permission);
}

/** A checker for several permissions in one component: const can = useCanFn(); can("tasks.tasks:edit"). */
export function useCanFn(): (permission: string) => boolean {
  const value = useContext(CurrentUserContext);
  return useMemo(() => (permission: string) => Boolean(value && (value.user.isAdmin || value.granted.has(permission))), [value]);
}

/** The built-in Admin role only. Do not use it to show or hide features: use useCan. */
export function useIsAdmin(): boolean {
  return useContext(CurrentUserContext)?.user.isAdmin ?? false;
}
