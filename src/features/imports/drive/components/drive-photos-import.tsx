"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown, FolderSearch, ImageIcon, Info, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { EmptyState } from "@/components/shared/empty-state";
import { useCan } from "@/components/current-user";
import { ItemThumb } from "@/features/inventory/items/components/item-photo";
import { emitDataChanged } from "@/lib/events";
import { formatFileSize, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addDrivePhoto, listDrivePhotos } from "../photos-actions";
import type { DrivePhotoItem, DrivePhotoPlan, DrivePhotoRow } from "../photos-types";

type Result = { status: "saved"; replaced: boolean } | { status: "skipped" | "failed"; reason: string };

type RowState = {
  row: DrivePhotoRow;
  item: DrivePhotoItem | null;
  /** Why the row cannot be added, or null when it can. */
  blocked: string | null;
  /** Can be added and was not left out. */
  willAdd: boolean;
  willReplace: boolean;
  result: Result | null;
};

/** Setup steps, shown until GOOGLE_DRIVE_API_KEY is set. */
function SetupNote() {
  return (
    <div className="space-y-3 rounded-xl border bg-surface/40 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Info className="size-4 text-muted-foreground" /> Google Drive import is not set up yet
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>In Google Cloud Console, enable the Google Drive API for a project and create an API key (APIs and services, Credentials).</li>
        <li>
          In Vercel, add it as <span className="font-mono text-foreground">GOOGLE_DRIVE_API_KEY</span> under Settings, Environment Variables, then redeploy.
        </li>
        <li>In Google Drive, share the photos folder as &quot;Anyone with the link&quot; (Viewer). The key can only read folders shared that way.</li>
      </ol>
      <p className="text-muted-foreground">Name each image after the item&apos;s SKU or name, for example LED-STRIP-5M.jpg or &quot;Copper wire 2.5mm.png&quot;.</p>
    </div>
  );
}

function ItemPicker({ items, value, onChange, disabled }: { items: DrivePhotoItem[]; value: DrivePhotoItem | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal", !value && "text-muted-foreground")}
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? <ItemThumb src={value.photoUrl} name={value.name} size="xs" className="size-6" /> : null}
            <span className="min-w-0 truncate text-left">{value ? value.name : "Pick an item"}</span>
            {value ? <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">{value.sku}</span> : null}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search name or SKU…" />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup>
              {value ? (
                <CommandItem
                  value="__none__ no item"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <X className="size-4 text-muted-foreground" /> No item (skip this file)
                </CommandItem>
              ) : null}
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.name} ${i.sku} ${i.id}`}
                  onSelect={() => {
                    onChange(i.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{i.name}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {i.sku}
                      {i.hasPhoto ? " · has a photo" : ""}
                    </span>
                  </div>
                  <Check className={cn("size-4 shrink-0", value?.id === i.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ResultNote({ result }: { result: Result }) {
  if (result.status === "saved") return <p className="text-xs font-medium text-success">{result.replaced ? "Photo replaced" : "Photo added"}</p>;
  return <p className={cn("text-xs", result.status === "failed" ? "text-danger" : "text-muted-foreground")}>{result.reason}</p>;
}

/**
 * Google Drive photos to inventory items (needs the Inventory import permission): paste a shared folder link, review which
 * image goes to which item (matched by SKU or name), then add them one file per request.
 * Existing photos are kept unless "Replace existing photos" is ticked.
 */
export function DrivePhotosImport({ configured }: { configured: boolean }) {
  const router = useRouter();
  const canImport = useCan("inventory.import:create");
  const [link, setLink] = useState("");
  const [finding, setFinding] = useState(false);
  const [plan, setPlan] = useState<DrivePhotoPlan | null>(null);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [replace, setReplace] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [photoAdded, setPhotoAdded] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ saved: number; replaced: number; skipped: number; failed: number; stopped: boolean } | null>(null);
  const stopRef = useRef(false);

  const itemsById = useMemo(() => new Map((plan?.items ?? []).map((i) => [i.id, i])), [plan]);

  const states: RowState[] = useMemo(() => {
    if (!plan) return [];
    const taken = new Set<string>();
    // In the order shown (matched, then not matched), so "above" in the message below is true.
    const shown = [...plan.rows.filter((r) => r.matchedItemId), ...plan.rows.filter((r) => !r.matchedItemId)];
    return shown.map((row) => {
      const itemId = row.driveFileId in chosen ? chosen[row.driveFileId] : row.matchedItemId;
      const item = itemId ? (itemsById.get(itemId) ?? null) : null;
      const result = results[row.driveFileId] ?? null;
      const hasPhoto = item ? item.hasPhoto || Boolean(photoAdded[item.id]) : false;
      let blocked: string | null = null;
      if (result) blocked = "Done";
      else if (row.problem) blocked = row.problem;
      else if (row.importedTo) blocked = row.importedTo.itemName ? `Imported before, to ${row.importedTo.itemName}.` : "Imported before.";
      else if (!item) blocked = row.unmatchedReason ?? "Pick an item.";
      else if (hasPhoto && !replace) blocked = "The item has a photo. Tick Replace existing photos to change it.";
      else if (taken.has(item.id) && !excluded[row.driveFileId]) blocked = "Another file above is already set for this item.";
      const willAdd = !blocked && !excluded[row.driveFileId];
      if (willAdd && item) taken.add(item.id);
      return { row, item, blocked, willAdd, willReplace: willAdd && hasPhoto, result };
    });
  }, [plan, chosen, itemsById, results, photoAdded, excluded, replace]);

  if (!canImport) return <EmptyState compact title="Your role cannot import" description="Ask an admin to import the photos for you." />;
  if (!configured) return <SetupNote />;

  const ready = states.filter((s) => s.willAdd);
  // Grouped by the name match only, so a row does not jump between lists when an item is picked.
  const matched = states.filter((s) => s.row.matchedItemId);
  const unmatched = states.filter((s) => !s.row.matchedItemId);
  const withPhotoCount = ready.filter((s) => s.willReplace).length;

  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setFinding(true);
    try {
      const result = await listDrivePhotos({ link });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPlan(result.data);
      setChosen({});
      setExcluded({});
      setResults({});
      setPhotoAdded({});
      setSummary(null);
      if (result.data.rows.length === 0) toast.info("No images in that folder. Only files directly in the folder are read, not subfolders.");
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setFinding(false);
    }
  }

  async function run() {
    const queue = ready.map((s) => ({ row: s.row, item: s.item! }));
    if (!queue.length) return;
    stopRef.current = false;
    setSummary(null);
    setRunning({ done: 0, total: queue.length });
    const tally = { saved: 0, replaced: 0, skipped: 0, failed: 0, stopped: false };
    for (const [index, { row, item }] of queue.entries()) {
      if (stopRef.current) {
        tally.stopped = true;
        break;
      }
      let outcome: Result;
      try {
        const res = await addDrivePhoto({ driveFileId: row.driveFileId, name: row.name, itemId: item.id, replace });
        if (!res.ok) outcome = { status: "failed", reason: res.error };
        else if (res.data.status === "saved") outcome = { status: "saved", replaced: res.data.replaced };
        else outcome = { status: "skipped", reason: res.data.reason };
      } catch {
        outcome = { status: "failed", reason: "Network error. Check your connection and try again." };
      }
      if (outcome.status === "saved") {
        tally.saved += 1;
        if (outcome.replaced) tally.replaced += 1;
        setPhotoAdded((p) => ({ ...p, [item.id]: true }));
      } else if (outcome.status === "skipped") tally.skipped += 1;
      else tally.failed += 1;
      setResults((r) => ({ ...r, [row.driveFileId]: outcome }));
      setRunning({ done: index + 1, total: queue.length });
    }
    setRunning(null);
    setSummary(tally);
    if (tally.saved) {
      emitDataChanged();
      router.refresh();
    }
  }

  const renderRow = (s: RowState) => {
    const id = s.row.driveFileId;
    return (
      <li key={id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Checkbox
            className="mt-0.5"
            checked={s.willAdd}
            disabled={Boolean(s.blocked) || Boolean(running)}
            onCheckedChange={(v) => setExcluded((x) => ({ ...x, [id]: v !== true }))}
            aria-label={`Add ${s.row.name}`}
          />
          <div className="min-w-0 space-y-0.5">
            <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{s.row.name}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {s.row.size !== null ? formatFileSize(s.row.size) : "Size unknown"}
              {s.row.matchedBy && !(id in chosen) ? ` · matched by ${s.row.matchedBy === "sku" ? "SKU" : "name"}` : ""}
              {id in chosen ? " · picked by you" : ""}
            </p>
            {s.result ? (
              <ResultNote result={s.result} />
            ) : s.blocked ? (
              <p className="text-xs text-muted-foreground">{s.blocked}</p>
            ) : !s.willAdd ? (
              <p className="text-xs text-muted-foreground">Left out</p>
            ) : s.willReplace ? (
              <p className="text-xs font-medium text-warning">Replaces the item&apos;s current photo</p>
            ) : (
              <p className="text-xs text-muted-foreground">Becomes the item&apos;s photo</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pl-7 sm:w-80 sm:pl-0">
          <div className="min-w-0 flex-1">
            <ItemPicker
              items={plan!.items}
              value={s.item}
              disabled={Boolean(running) || Boolean(s.result) || Boolean(s.row.problem) || Boolean(s.row.importedTo)}
              onChange={(itemId) => setChosen((c) => ({ ...c, [id]: itemId }))}
            />
          </div>
          {s.item?.hasPhoto ? <ItemThumb src={s.item.photoUrl} name={s.item.name} size="xs" className="size-9" /> : null}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <form onSubmit={find} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="drive-photos-link" className="text-[13px]">
            Google Drive folder link
          </Label>
          <Input
            id="drive-photos-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            inputMode="url"
            autoComplete="off"
            disabled={Boolean(running)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={finding || Boolean(running) || !link.trim()}>
          {finding ? <Loader2 className="animate-spin" /> : <FolderSearch />} Find photos
        </Button>
      </form>
      <p className="-mt-3 text-xs text-muted-foreground">
        Share the folder as &quot;Anyone with the link&quot;. Each image named after an item&apos;s SKU or name (case, spaces, dashes and underscores do not matter) is matched to it. Nothing is saved until you click Add photos.
      </p>

      {plan && plan.rows.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {formatNumber(plan.rows.length)} images: {formatNumber(matched.length)} matched, {formatNumber(unmatched.length)} not matched
              </p>
              <p className="text-xs text-muted-foreground">
                {formatNumber(ready.length)} will be added{withPhotoCount ? `, ${formatNumber(withPhotoCount)} of them replacing a photo` : ""}.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={replace} onCheckedChange={(v) => setReplace(v === true)} disabled={Boolean(running)} />
              Replace existing photos
            </label>
          </div>

          {matched.length ? (
            <div>
              <p className="eyebrow">Matched ({formatNumber(matched.length)})</p>
              <ul className="divide-y">{matched.map(renderRow)}</ul>
            </div>
          ) : null}
          {unmatched.length ? (
            <div>
              <p className="eyebrow">Not matched ({formatNumber(unmatched.length)})</p>
              <p className="text-xs text-muted-foreground">Pick an item for a file to add it, or leave it to skip it.</p>
              <ul className="divide-y">{unmatched.map(renderRow)}</ul>
            </div>
          ) : null}

          <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t bg-card/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            {running ? (
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Adding {formatNumber(running.done + 1 > running.total ? running.total : running.done + 1)} of {formatNumber(running.total)}…
                </p>
                <Progress value={Math.round((running.done / running.total) * 100)} className="h-1.5" />
              </div>
            ) : summary ? (
              <p className="text-sm" role="status">
                {formatNumber(summary.saved)} added{summary.replaced ? ` (${formatNumber(summary.replaced)} replaced)` : ""}, {formatNumber(summary.skipped)} skipped,{" "}
                <span className={cn(summary.failed && "font-medium text-danger")}>{formatNumber(summary.failed)} failed</span>
                {summary.stopped ? ". Stopped before the end." : "."}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">One file is added at a time. You can stop at any point.</p>
            )}
            <div className="flex gap-2">
              {running ? (
                <Button type="button" variant="outline" onClick={() => (stopRef.current = true)}>
                  Stop
                </Button>
              ) : null}
              <Button type="button" onClick={run} disabled={Boolean(running) || ready.length === 0}>
                {running ? <Loader2 className="animate-spin" /> : null} Add photos{ready.length ? ` (${formatNumber(ready.length)})` : ""}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
