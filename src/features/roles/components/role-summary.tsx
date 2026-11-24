import { pagesOpened } from "../model";

/** Read-only "who can see what": the pages a permission list opens, by module, and its data permissions. */
export function RoleSummary({ permissions, className }: { permissions: readonly string[]; className?: string }) {
  const { modules, settings, data } = pagesOpened(permissions);
  if (!modules.length && !settings.length) {
    return <p className={className ?? "text-sm text-muted-foreground"}>Opens no pages. People with this role see a note asking them to contact an admin.</p>;
  }
  return (
    <dl className={className ?? "grid gap-3 text-sm sm:grid-cols-2"}>
      {modules.map((m) => (
        <div key={m.title} className="min-w-0">
          <dt className="font-medium">{m.title}</dt>
          <dd className="text-muted-foreground">{m.pages.join(", ")}</dd>
        </div>
      ))}
      {settings.length ? (
        <div className="min-w-0">
          <dt className="font-medium">Settings</dt>
          <dd className="text-muted-foreground">{settings.join(", ")}</dd>
        </div>
      ) : null}
      <div className="min-w-0">
        <dt className="font-medium">Data</dt>
        <dd className="text-muted-foreground">{data.length ? data.join(", ") : "No individual salaries and no company financial position"}</dd>
      </div>
    </dl>
  );
}
