"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Columns3, Copy, Download, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useIsAdmin } from "@/components/current-user";
import { SCENARIO_STATUSES, labelOf, type ScenarioStatus } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { changeScenarioStatus, deleteScenario, duplicateScenario, recalculateScenario } from "../actions";

/** Edit, duplicate, status, update results, export, compare and (admins) delete. */
export function ScenarioActions({
  id,
  code,
  status,
  hasSaved,
  canExport,
  outdated,
  canRecalculate = true,
}: {
  id: string;
  code: string;
  status: ScenarioStatus;
  hasSaved: boolean;
  canExport: boolean;
  /** Saved results differ from today's, or there are none. */
  outdated: boolean;
  /** False for a member when an admin's results (with salary and cash figures) are saved. */
  canRecalculate?: boolean;
}) {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [pending, startTransition] = useTransition();
  const [next, setNext] = useState<ScenarioStatus | null>(null);
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Approve and reject are admin decisions, and only an admin moves a scenario out of one.
  const decided = status === "approved" || status === "rejected";
  const choices = isAdmin ? SCENARIO_STATUSES.filter((s) => s.value !== status) : decided ? [] : SCENARIO_STATUSES.filter((s) => s.value !== status && s.value !== "approved" && s.value !== "rejected");

  const done = (message?: string) => {
    toast.success(message ?? "Done");
    emitDataChanged();
    router.refresh();
  };

  const duplicate = () =>
    startTransition(async () => {
      const r = await duplicateScenario({ id });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.code} created as a draft copy`);
      emitDataChanged();
      router.push(`/analytics/scenarios/${r.data.id}`);
    });

  const recalculate = () =>
    startTransition(async () => {
      const r = await recalculateScenario({ id });
      if (!r.ok) return void toast.error(r.error);
      done(r.message);
    });

  const saveStatus = () =>
    startTransition(async () => {
      if (!next) return;
      const r = await changeScenarioStatus({ id, status: next, note });
      if (!r.ok) return void toast.error(r.error);
      setNext(null);
      setNote("");
      done(`${code} is now ${labelOf(SCENARIO_STATUSES, next).toLowerCase()}`);
    });

  const exportHref = (format: "xlsx" | "pdf", basis: "today" | "saved") => `/api/analytics/scenarios/${id}/export?format=${format}&basis=${basis}`;

  return (
    <>
      <Button asChild variant="outline">
        <Link href={`/analytics/scenarios/${id}/edit`}>
          <Pencil /> Edit
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={pending}>
            Status <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
          {choices.map((c) => (
            <DropdownMenuItem key={c.value} onSelect={() => setNext(c.value)}>
              {c.label}
            </DropdownMenuItem>
          ))}
          {!isAdmin ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {decided ? "Only admins change a decided scenario. Editing it sends it back to Saved." : "Only admins approve or reject."}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={pending}>
            {pending ? <Spinner /> : null} More <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={duplicate}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={recalculate} disabled={!outdated || !canRecalculate}>
            <RefreshCw /> Update saved results
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/analytics/compare?ids=${id}`}>
              <Columns3 /> Compare with others
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">Export with today&apos;s data</DropdownMenuLabel>
          <DropdownMenuItem asChild disabled={!canExport}>
            <a href={exportHref("xlsx", "today")}>
              <Download /> Excel (.xlsx)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!canExport}>
            <a href={exportHref("pdf", "today")}>
              <Download /> PDF
            </a>
          </DropdownMenuItem>
          {hasSaved ? (
            <>
              <DropdownMenuLabel className="text-xs">Export as saved</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <a href={exportHref("xlsx", "saved")}>
                  <Download /> Excel (.xlsx)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref("pdf", "saved")}>
                  <Download /> PDF
                </a>
              </DropdownMenuItem>
            </>
          ) : null}
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={next !== null} onOpenChange={(o) => !o && !pending && setNext(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {code} to {next ? labelOf(SCENARIO_STATUSES, next).toLowerCase() : ""}</DialogTitle>
            <DialogDescription>The change and your note are kept in the scenario&apos;s history.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder={next === "approved" || next === "rejected" ? "Why, for the record" : "Optional note"} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNext(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveStatus} disabled={pending}>
              {pending ? <Spinner /> : null} Change status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${code}?`}
        description="The scenario, its saved results and its history are removed. Real records are not touched, since a scenario never changed them. This cannot be undone."
        onConfirm={async () => {
          const r = await deleteScenario({ id });
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          toast.success(`${code} deleted`);
          emitDataChanged();
          router.push("/analytics/scenarios");
        }}
      />
    </>
  );
}
