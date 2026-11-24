import { NoAccess } from "./no-access";

/**
 * Kept so older imports keep working: the NoAccess note with the "Finance" eyebrow these pages
 * had. New code uses NoAccess from ./no-access.
 */
export function AdminOnly({ title, eyebrow = "Finance" }: { title: string; eyebrow?: string }) {
  return <NoAccess title={title} eyebrow={eyebrow} />;
}
