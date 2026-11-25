import { redirect } from "next/navigation";
import { MODULES, visibleItems } from "@/config/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";

/** /hr opens the first HR page the person's role opens. */
export default async function HrHome() {
  const user = await requireUser();
  const hr = MODULES.find((m) => m.id === "hr");
  const href = hr ? visibleItems(hr.items, (p) => can(user, p))[0]?.href : undefined;
  if (href) redirect(href);
  return <NoAccess eyebrow="HR" title="HR" />;
}
