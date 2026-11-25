/**
 * Permission types shared by the server and the browser. Client-safe.
 *
 * A permission is "<resource>:<action>" (for example "finance.equity:view"), or one of the data
 * permissions ("data.salaries", "data.financial_position").
 */

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export" | "approve";

export type PermissionResource = {
  /** Stable key, stored in roles. Never rename one. */
  key: string;
  module: "finance" | "inventory" | "analytics" | "tasks" | "hr" | "settings";
  /** Heading the resource sits under in the roles matrix. */
  group: string;
  label: string;
  description?: string;
  /** The actions this resource has. Every resource has "view". */
  actions: PermissionAction[];
  /** What the built-in Member role may do by default: exactly what members could do before roles existed. */
  memberDefault: PermissionAction[];
};

export type DataPermission = {
  key: "data.salaries" | "data.financial_position";
  label: string;
  description: string;
  memberDefault: boolean;
};

export type Permission = string;
