"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FormSheet } from "@/components/shared/form-sheet";
import { useOnLiveChange } from "@/components/live-updates";
import { emitDataChanged } from "@/lib/events";
import type { LiabilityKind } from "@/lib/constants";
import type { BankAccountOption } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { deleteLiabilityAction, fetchLiability } from "../actions";
import { LOAN_GROUPS, nearestBuiltIn, type LiabilitySide } from "../groups";
import type { LiabilityDetail } from "../types";
import { LiabilityForm } from "./liability-form";
import { LiabilityDetailSkeleton, LiabilityDetailView } from "./liability-detail";

type Panel = { kind: "new"; group: string | null } | { kind: "view"; id: string } | { kind: "edit"; id: string } | null;

/**
 * Opens the liability drawers through the URL: ?new=1 (with &newGroup=<key> to preselect a group),
 * ?view=<id> and ?edit=<id>, so the balance sheet, the dashboard and the command palette can link to them.
 */
export function useLiabilityPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panel: Panel = useMemo(() => {
    if (searchParams.get("new") === "1") return { kind: "new", group: searchParams.get("newGroup") };
    const edit = searchParams.get("edit");
    if (edit) return { kind: "edit", id: edit };
    const view = searchParams.get("view");
    if (view) return { kind: "view", id: view };
    return null;
  }, [searchParams]);
  const setPanel = useCallback(
    (next: Panel) => {
      const params = new URLSearchParams(searchParams.toString());
      // "newGroup", not "group": the loans list filters by ?group= and must keep it.
      for (const k of ["new", "view", "edit", "newGroup"]) params.delete(k);
      if (next?.kind === "new") {
        params.set("new", "1");
        if (next.group) params.set("newGroup", next.group);
      }
      if (next?.kind === "view") params.set("view", next.id);
      if (next?.kind === "edit") params.set("edit", next.id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  return { panel, setPanel };
}

/** The create, view and edit drawers for liabilities on one page. */
export function LiabilityPanels({
  groups,
  accounts,
  lenders,
  defaultKind,
  side,
  categories,
}: {
  groups: GroupOption[];
  accounts: BankAccountOption[];
  lenders: string[];
  defaultKind: LiabilityKind;
  side?: LiabilitySide;
  /** Expense categories for an accrued obligation (see LiabilityForm). */
  categories?: { value: string; label: string }[];
}) {
  const { panel, setPanel } = useLiabilityPanel();
  const [detail, setDetail] = useState<LiabilityDetail | null>(null);
  const [version, setVersion] = useState(0);

  const panelId = panel && panel.kind !== "new" ? panel.id : null;
  if (!panelId && detail) setDetail(null);
  useEffect(() => {
    if (!panelId) return;
    let cancelled = false;
    fetchLiability(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That liability no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .catch(() => !cancelled && toast.error("Could not load the liability. Check your connection."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, version]);

  // Someone else's change reloads the record while it is only being shown, never while it is being edited.
  const viewing = useRef<string | null>(null);
  useEffect(() => {
    viewing.current = panel?.kind === "view" ? panel.id : null;
  });
  useOnLiveChange(() => {
    const id = viewing.current;
    if (!id || detail?.id !== id) return;
    fetchLiability(id)
      .then((d) => {
        if (viewing.current !== id) return;
        if (d) setDetail(d);
      })
      .catch(() => {
        // Offline: keep what is shown; the next change tries again.
      });
  });

  async function remove(l: LiabilityDetail) {
    const result = await deleteLiabilityAction({ id: l.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${l.code} deleted`);
    viewing.current = null;
    emitDataChanged();
    setPanel(null);
    return true;
  }

  const reload = () => setVersion((v) => v + 1);
  // "Add" from a loan group opens the loan form; from any other group, the obligation form.
  const newKind: LiabilityKind =
    panel?.kind === "new" && panel.group ? (LOAN_GROUPS.includes(nearestBuiltIn(groups, panel.group)?.key ?? "") ? "loan" : "other") : defaultKind;
  const editing = panel?.kind === "edit";
  // A reload after a repayment keeps the record on screen; only a first open shows the skeleton.
  const ready = panel && panel.kind !== "new" && detail?.id === panel.id ? detail : null;

  return (
    <FormSheet
      open={panel !== null}
      onOpenChange={(o) => !o && setPanel(null)}
      size="lg"
      title={panel?.kind === "new" ? (newKind === "loan" ? "Add loan" : "Add liability") : editing ? "Edit liability" : (detail?.name ?? "Liability")}
      description={panel?.kind === "new" ? "A loan, borrowing or other amount the company owes." : detail ? `${detail.code} · ${detail.groupLabel}` : undefined}
    >
      {panel?.kind === "new" ? (
        <LiabilityForm
          groups={groups}
          accounts={accounts}
          lenders={lenders}
          defaultKind={newKind}
          defaultGroup={panel.group ?? undefined}
          side={side}
          categories={categories}
          onDone={(id) => setPanel({ kind: "view", id })}
          onCancel={() => setPanel(null)}
        />
      ) : !ready ? (
        <LiabilityDetailSkeleton />
      ) : editing ? (
        <LiabilityForm
          key={ready.id}
          liability={ready}
          groups={groups}
          accounts={accounts}
          lenders={lenders}
          defaultKind={ready.kind}
          categories={categories}
          onDone={(id) => {
            setDetail(null);
            reload();
            setPanel({ kind: "view", id });
          }}
          onCancel={() => setPanel({ kind: "view", id: ready.id })}
        />
      ) : (
        <LiabilityDetailView liability={ready} accounts={accounts} onEdit={() => setPanel({ kind: "edit", id: ready.id })} onDelete={() => remove(ready)} onChanged={reload} />
      )}
    </FormSheet>
  );
}
