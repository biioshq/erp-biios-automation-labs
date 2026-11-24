import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { SETTINGS_PAGES, canOpen, firstAllowedHref } from "@/config/navigation";
import { can, requireUser } from "@/server/auth/session";

/** The start page: the first page the person's role opens, in sidebar order (Finance for admins and members). */
export default async function Home() {
  const user = await requireUser();
  const allowed = (p: string) => can(user, p);
  const href = firstAllowedHref(allowed) ?? SETTINGS_PAGES.find((p) => canOpen(p, allowed))?.href;
  if (href) redirect(href);
  return (
    <NoAccess
      title={`Welcome, ${user.name}`}
      description={
        user.roleName === "Role missing"
          ? "Your role no longer exists, so no pages are open to you. Ask an admin to give you a role."
          : "Your role does not open any pages yet. Ask an admin if you need access."
      }
    />
  );
}
