"use client";

import type { ScenarioType } from "@/lib/constants";
import type { TypeFormProps } from "./options";
import { DemandForm } from "./demand-form";
import { SupplyDelayForm } from "./supply-delay-form";
import { NewProjectForm } from "./new-project-form";
import { PriceForm } from "./price-form";
import { BudgetForm } from "./budget-form";
import { ManpowerForm } from "./manpower-form";
import { EquipmentForm } from "./equipment-form";

/** The create and edit form for any scenario type. */
export function ScenarioForm({ type, ...props }: TypeFormProps & { type: ScenarioType }) {
  switch (type) {
    case "demand":
      return <DemandForm {...props} />;
    case "supply_delay":
      return <SupplyDelayForm {...props} />;
    case "new_project":
      return <NewProjectForm {...props} />;
    case "price":
      return <PriceForm {...props} />;
    case "budget":
      return <BudgetForm {...props} />;
    case "manpower":
      return <ManpowerForm {...props} />;
    case "equipment":
      return <EquipmentForm {...props} />;
  }
}
