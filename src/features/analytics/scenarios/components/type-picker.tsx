import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SCENARIO_TYPES } from "@/lib/constants";
import { SCENARIO_TYPE_META } from "./badges";

/** The seven scenario types as cards; each opens its form. */
export function ScenarioTypePicker() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {SCENARIO_TYPES.map((t) => {
        const meta = SCENARIO_TYPE_META[t.value];
        const Icon = meta.icon;
        return (
          <Link
            key={t.value}
            href={`/analytics/scenarios/new?type=${t.value}`}
            className="group flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-card transition-colors hover:border-brand/40 sm:p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/12 text-brand-ink">
                <Icon className="size-4" />
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">{t.label}</p>
              <p className="text-sm text-pretty text-muted-foreground">{meta.summary}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
