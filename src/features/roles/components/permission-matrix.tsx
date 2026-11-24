"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  ACTION_LABELS,
  ACTION_ORDER,
  ALL_RESOURCES,
  DATA_PERMISSIONS,
  MODULE_LABELS,
  perm,
  type PermissionAction,
  type PermissionResource,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { resetMemberRole, saveRolePermissions } from "../actions";
import { RoleSummary } from "./role-summary";

type ModuleBlock = { module: PermissionResource["module"]; groups: { group: string; resources: PermissionResource[] }[] };

/** The catalogue as the matrix shows it: modules, then groups, then one row per resource. */
const BLOCKS: ModuleBlock[] = (() => {
  const blocks: ModuleBlock[] = [];
  for (const r of ALL_RESOURCES) {
    let block = blocks.find((b) => b.module === r.module);
    if (!block) blocks.push((block = { module: r.module, groups: [] }));
    let group = block.groups.find((g) => g.group === r.group);
    if (!group) block.groups.push((group = { group: r.group, resources: [] }));
    group.resources.push(r);
  }
  return blocks;
})();

const rowPermissions = (r: PermissionResource) => r.actions.map((a) => perm(r.key, a));

/**
 * The permission matrix of one role. "View" opens the page; every other action needs it, so
 * ticking create, edit, delete, export or approve ticks view, and unticking view clears the row.
 * People who are not admins can only tick permissions their own role has (`grantable`); the server
 * applies the same rule when saving.
 */
export function PermissionMatrix({
  roleKey,
  initial,
  editable,
  grantable,
  canReset,
}: {
  roleKey: string;
  initial: string[];
  editable: boolean;
  /** null for admins (anything); otherwise the editor's own permissions. */
  grantable: string[] | null;
  canReset: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [pending, startTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const initialSet = useMemo(() => new Set(initial), [initial]);
  const grantSet = useMemo(() => (grantable ? new Set(grantable) : null), [grantable]);

  /** May the editor tick this one? Already-held permissions can always stay. */
  const allowed = (p: string) => editable && (!grantSet || grantSet.has(p) || initialSet.has(p));

  const changes = useMemo(() => {
    let n = 0;
    for (const p of selected) if (!initialSet.has(p)) n++;
    for (const p of initialSet) if (!selected.has(p)) n++;
    return n;
  }, [selected, initialSet]);

  const update = (fn: (next: Set<string>) => void) =>
    setSelected((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });

  const toggle = (r: PermissionResource, action: PermissionAction, on: boolean) =>
    update((next) => {
      const p = perm(r.key, action);
      if (action === "view" && !on) {
        for (const q of rowPermissions(r)) next.delete(q);
        return;
      }
      if (on) {
        next.add(p);
        const view = perm(r.key, "view");
        if (r.actions.includes("view") && allowed(view)) next.add(view);
      } else {
        next.delete(p);
      }
    });

  const moduleState = (block: ModuleBlock) => {
    const perms = block.groups.flatMap((g) => g.resources.flatMap(rowPermissions)).filter(allowed);
    const on = perms.filter((p) => selected.has(p)).length;
    return { perms, checked: perms.length > 0 && on === perms.length ? true : on > 0 ? ("indeterminate" as const) : false };
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveRolePermissions({ key: roleKey, permissions: [...selected] });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Permissions saved. They apply on each person's next page load.");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        {BLOCKS.map((block) => {
          const state = moduleState(block);
          return (
            <section key={block.module} aria-labelledby={`mod-${block.module}`} className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`mod-${block.module}`} className="text-base font-semibold">
                  {MODULE_LABELS[block.module]}
                </h2>
                {editable && state.perms.length ? (
                  <label className="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={state.checked}
                      onCheckedChange={() =>
                        update((next) => {
                          const all = state.checked === true;
                          for (const p of state.perms) {
                            if (all) next.delete(p);
                            else next.add(p);
                          }
                        })
                      }
                      aria-label={`Select everything in ${MODULE_LABELS[block.module]}`}
                    />
                    Select all
                  </label>
                ) : null}
              </div>
              {/* Scrolls sideways inside its own box on phones; the first column stays in view. */}
              <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
                <table className="w-full min-w-[500px] border-collapse text-sm sm:min-w-[600px]">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th scope="col" className="sticky left-0 z-10 w-36 bg-muted px-3 py-2 text-left text-xs font-medium sm:w-[44%]">
                        Page or feature
                      </th>
                      {ACTION_ORDER.map((a) => (
                        <th key={a} scope="col" className="px-1 py-2 text-center text-xs font-medium">
                          {ACTION_LABELS[a]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.groups.map((g) => (
                      <Fragment key={g.group}>
                        {block.groups.length > 1 || g.group !== MODULE_LABELS[block.module] ? (
                          <tr className="border-b bg-muted/20">
                            <th scope="colgroup" colSpan={ACTION_ORDER.length + 1} className="sticky left-0 bg-muted/20 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                              {g.group}
                            </th>
                          </tr>
                        ) : null}
                        {g.resources.map((r) => (
                          <tr key={r.key} className="border-b last:border-b-0">
                            <th scope="row" className="sticky left-0 z-10 w-36 bg-card px-3 py-2 text-left align-top font-normal sm:w-[44%]">
                              <span className="block font-medium">{r.label}</span>
                              {r.description ? <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:line-clamp-none">{r.description}</span> : null}
                            </th>
                            {ACTION_ORDER.map((a) => {
                              if (!r.actions.includes(a)) return <td key={a} className="px-1 py-2 text-center text-muted-foreground/40" aria-hidden />;
                              const p = perm(r.key, a);
                              return (
                                <td key={a} className="px-1 py-2 text-center align-top">
                                  <span className="inline-flex size-9 items-center justify-center">
                                    <Checkbox
                                      checked={selected.has(p)}
                                      disabled={!allowed(p)}
                                      onCheckedChange={(v) => toggle(r, a, v === true)}
                                      aria-label={`${r.label}: ${ACTION_LABELS[a]}`}
                                    />
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        <section aria-labelledby="data-perms" className="space-y-2">
          <h2 id="data-perms" className="text-base font-semibold">
            Data across pages
          </h2>
          <div className="divide-y rounded-xl border bg-card shadow-card">
            {DATA_PERMISSIONS.map((d) => (
              <label key={d.key} className={cn("flex items-start gap-3 px-3 py-3", allowed(d.key) ? "cursor-pointer" : "cursor-not-allowed opacity-80")}>
                <Checkbox
                  checked={selected.has(d.key)}
                  disabled={!allowed(d.key)}
                  onCheckedChange={(v) => update((next) => (v === true ? next.add(d.key) : next.delete(d.key)))}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block text-xs text-muted-foreground">{d.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="who-sees" className="space-y-2">
        <h2 id="who-sees" className="text-base font-semibold">
          Who can see what
        </h2>
        <p className="text-sm text-muted-foreground">The pages this role opens{editable ? " with the boxes ticked above" : ""}.</p>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <RoleSummary permissions={[...selected]} />
        </div>
      </section>

      {editable ? (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
          <p className="mr-auto text-sm text-muted-foreground">
            {changes ? `${changes} unsaved ${changes === 1 ? "change" : "changes"}` : "No unsaved changes"}
          </p>
          {canReset ? (
            <Button type="button" variant="outline" onClick={() => setResetOpen(true)} disabled={pending}>
              <RotateCcw /> Reset to default
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setSelected(new Set(initial))} disabled={pending || !changes}>
            Discard changes
          </Button>
          <Button type="button" onClick={save} disabled={pending || !changes} className="min-w-36">
            {pending ? <Spinner /> : <Save />}
            Save permissions
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset Member to its default?"
        description="Member goes back to exactly what members could do before roles were added. Your edits to Member are removed."
        confirmLabel="Reset"
        onConfirm={async () => {
          const result = await resetMemberRole({ key: "member" });
          if (!result.ok) {
            toast.error(result.error);
            return false;
          }
          toast.success("Member is back to its default permissions");
          router.refresh();
        }}
      />
    </div>
  );
}
