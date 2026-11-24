"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useIsAdmin } from "@/components/current-user";
import { saveMonthForecastAction } from "../actions";

/**
 * Admins: store this month's forecasts now, for Forecast vs actual. Stored rows are never changed,
 * so pressing it again only adds items or projects that had no forecast yet this month.
 */
export function SaveForecastButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!isAdmin) return null;

  function save() {
    startTransition(async () => {
      const result = await saveMonthForecastAction({});
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { materials, projects } = result.data;
      toast.success(
        materials + projects === 0
          ? "This month's forecast was already saved. Nothing new to add."
          : `Saved this month's forecast: ${materials} ${materials === 1 ? "material" : "materials"} and ${projects} ${projects === 1 ? "project" : "projects"}.`,
      );
      router.refresh();
    });
  }

  return (
    <Button variant={variant} onClick={save} disabled={pending}>
      {pending ? <Spinner /> : <Save />} Save this month&apos;s forecast
    </Button>
  );
}
