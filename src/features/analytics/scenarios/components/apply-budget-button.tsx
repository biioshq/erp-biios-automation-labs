"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import { applyScenarioBudget } from "../apply-actions";
import type { ScenarioBudgetTarget } from "../server/project-budget";

/**
 * "Use as project budget" on a whole-project budget scenario: sets the project's budget to the
 * proposed figure after a confirm that shows the budget today and the new one. Needs the projects
 * edit permission (the server checks again and works the figure out from the saved inputs).
 */
export function ApplyBudgetButton({ target }: { target: ScenarioBudgetTarget }) {
  const router = useRouter();
  const canEdit = useCan("finance.projects:edit");
  if (!canEdit) return null;
  const same = round2(target.currentBudget) === round2(target.proposedBudget);
  const moved = round2(target.currentBudget) !== round2(target.scenarioBaseBudget);

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={same} title={same ? "The project budget is already this figure" : undefined}>
          <Wallet /> Use as project budget
        </Button>
      }
      title={`Set the budget of ${target.projectName}?`}
      destructive={false}
      confirmLabel="Use as project budget"
      description={
        <span className="block space-y-2">
          <span className="block">
            Budget today <Money value={target.currentBudget} className="font-medium text-foreground" />, new budget{" "}
            <Money value={target.proposedBudget} className="font-medium text-foreground" />.
          </span>
          {moved ? (
            <span className="block">
              This scenario started from a budget of <Money value={target.scenarioBaseBudget} />; the project budget has changed since.
            </span>
          ) : null}
          <span className="block">The old budget is kept in the project&apos;s budget history with a note naming {target.code}.</span>
        </span>
      }
      onConfirm={async () => {
        const result = await applyScenarioBudget({ id: target.scenarioId, expectedBudget: target.currentBudget });
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        toast.success(result.data.changed ? `Budget of ${target.projectName} set to the scenario's figure` : "The budget is unchanged");
        emitDataChanged();
        router.refresh();
      }}
    />
  );
}
