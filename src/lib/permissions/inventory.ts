import type { PermissionResource } from "./types";

/**
 * Inventory. Member defaults match what a member could do before roles existed: every inventory
 * page was open to members, and members could add and edit items and categories, adjust stock,
 * set item photos, purchase, assign, return, move and relocate stock, record wastage and export
 * the movement history. Only admins could archive or delete an item, remove an item photo,
 * delete a category or import items (members saw the Import page with a note instead).
 */
export const INVENTORY_RESOURCES: PermissionResource[] = [
  {
    key: "inventory.dashboard",
    module: "inventory",
    group: "Inventory",
    label: "Inventory dashboard",
    description: "Stock levels, value and recent movement across every item.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "inventory.items",
    module: "inventory",
    group: "Inventory",
    label: "Items",
    description: "The item list and item pages. Edit covers changing an item, adjusting stock and setting its photo. Delete covers archiving or deleting an item and removing its photo.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "inventory.categories",
    module: "inventory",
    group: "Inventory",
    label: "Item categories",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "inventory.low_stock",
    module: "inventory",
    group: "Inventory",
    label: "Low stock",
    description: "The reorder list and stock alerts.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "inventory.import",
    module: "inventory",
    group: "Inventory",
    label: "Import items",
    description: "Items from a CSV or Excel file and item photos from Google Drive. View shows the page; create runs an import.",
    actions: ["view", "create"],
    memberDefault: ["view"],
  },
  {
    key: "inventory.purchase",
    module: "inventory",
    group: "Stock operations",
    label: "Purchase stock",
    description: "Recording stock bought, with its receipt. A purchase also adds an expense.",
    actions: ["view", "create"],
    memberDefault: ["view", "create"],
  },
  {
    key: "inventory.movement",
    module: "inventory",
    group: "Stock operations",
    label: "Assign, return and transfer stock",
    description: "Assigning stock to a project, returning it, moving it between projects and moving an item to another storage location.",
    actions: ["view", "create"],
    memberDefault: ["view", "create"],
  },
  {
    key: "inventory.wastage",
    module: "inventory",
    group: "Stock operations",
    label: "Wastage",
    description: "Recording damaged, expired or lost stock, and the wastage list.",
    actions: ["view", "create"],
    memberDefault: ["view", "create"],
  },
  {
    key: "inventory.movements",
    module: "inventory",
    group: "Stock operations",
    label: "Movement history",
    description: "Every change to stock, with the balance it left behind. Export downloads the filtered list.",
    actions: ["view", "export"],
    memberDefault: ["view", "export"],
  },
];
