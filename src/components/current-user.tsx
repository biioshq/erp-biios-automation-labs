"use client";

import { createContext, useContext } from "react";
import type { UserRole } from "@/lib/constants";

export type CurrentUser = { id: string; name: string; email: string; image: string | null; role: UserRole };

const CurrentUserContext = createContext<CurrentUser | null>(null);

/** Provided by the app layout. Server actions still enforce roles; this only hides controls. */
export function CurrentUserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return <CurrentUserContext value={user}>{children}</CurrentUserContext>;
}

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser must be used inside the app layout");
  return user;
}

export function useIsAdmin(): boolean {
  return useContext(CurrentUserContext)?.role === "admin";
}
