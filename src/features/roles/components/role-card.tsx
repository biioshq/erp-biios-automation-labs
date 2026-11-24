"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Copy, Lock, MoreHorizontal, PencilLine, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { formatNumber } from "@/lib/format";
import { deleteRole, duplicateRole, renameRole, resetMemberRole } from "../actions";
import { renameRoleSchema, type RenameRoleInput, type RenameRoleValues } from "../schemas";
import type { RoleSummary as Role } from "../model";
import { RoleSummary } from "./role-summary";

/** What the viewer may do with this role. The server checks the same rules again. */
export type RoleCardFlags = { editable: boolean; renamable: boolean; deletable: boolean; duplicable: boolean };

export function RoleCard({ role, flags, isOwnRole }: { role: Role; flags: RoleCardFlags; isOwnRole: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "delete" | "reset" | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = role.people.slice(0, 6).map((p) => p.name);
  const more = role.people.length - shown.length;
  const hasMenu = flags.editable || flags.duplicable || role.locked;

  const duplicate = () =>
    startTransition(async () => {
      const result = await duplicateRole({ key: role.key });
      if (!result.ok) return void toast.error(result.error);
      toast.success(`Copied ${role.name}`);
      router.push(`/settings/roles/${result.data.key}`);
    });

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="truncate">{role.name}</span>
            {role.locked ? (
              <StatusBadge tone="brand">
                <Lock className="size-3" aria-hidden /> Every permission
              </StatusBadge>
            ) : role.builtIn ? (
              <StatusBadge tone="neutral">{role.isDefault ? "Built in, default" : "Built in, edited"}</StatusBadge>
            ) : (
              <StatusBadge tone="info">Custom</StatusBadge>
            )}
            {isOwnRole ? <StatusBadge tone="neutral">Your role</StatusBadge> : null}
          </CardTitle>
          {role.description ? <CardDescription>{role.description}</CardDescription> : null}
        </div>
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`Manage ${role.name}`} disabled={pending}>
                {pending ? <Spinner /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link href={`/settings/roles/${role.key}`}>
                  <SlidersHorizontal /> {flags.editable ? "Edit permissions" : "See permissions"}
                </Link>
              </DropdownMenuItem>
              {flags.renamable ? (
                <DropdownMenuItem onSelect={() => setDialog("rename")}>
                  <PencilLine /> Rename
                </DropdownMenuItem>
              ) : null}
              {flags.duplicable ? (
                <DropdownMenuItem onSelect={duplicate}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
              ) : null}
              {flags.editable && role.key === "member" && !role.isDefault ? (
                <DropdownMenuItem onSelect={() => setDialog("reset")}>
                  <RotateCcw /> Reset to default
                </DropdownMenuItem>
              ) : null}
              {flags.deletable ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="tabular font-medium">{formatNumber(role.people.length)}</span>{" "}
          <span className="text-muted-foreground">
            {role.people.length === 1 ? "person" : "people"}
            {shown.length ? `: ${shown.join(", ")}${more > 0 ? ` and ${formatNumber(more)} more` : ""}` : ""}
          </span>
        </p>
        <details className="group rounded-lg border bg-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium select-none">Who can see what</summary>
          <div className="pt-3">
            <RoleSummary permissions={role.permissions} />
          </div>
        </details>
        <Button asChild variant="outline" size="sm" className="max-sm:w-full">
          <Link href={`/settings/roles/${role.key}`}>
            <SlidersHorizontal /> {flags.editable ? "Edit permissions" : "See permissions"}
          </Link>
        </Button>
      </CardContent>

      {dialog === "rename" ? <RenameRoleDialog role={role} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        title={`Delete ${role.name}?`}
        description={
          role.people.length
            ? `People still have this role: ${role.people.map((p) => p.name).join(", ")}. Give them another role on the Team page first.`
            : "Nobody has this role. Deleting it cannot be undone."
        }
        onConfirm={async () => {
          const result = await deleteRole({ key: role.key });
          if (!result.ok) {
            toast.error(result.error);
            return false;
          }
          toast.success(`${role.name} was deleted`);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        onOpenChange={(o) => setDialog(o ? "reset" : null)}
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
    </Card>
  );
}

function RenameRoleDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<RenameRoleInput, unknown, RenameRoleValues>({
    resolver: zodResolver(renameRoleSchema),
    defaultValues: { key: role.key, name: role.name, description: role.description },
    ...formValidation,
  });
  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await renameRole(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success("Role updated");
      onClose();
      router.refresh();
    });
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Rename role</DialogTitle>
            <DialogDescription>People keep the role; only its name and description change.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField control={form.control} name="name" label="Name" required />
            <TextareaField control={form.control} name="description" label="Description" rows={2} />
          </div>
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-w-28">
              {pending ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
