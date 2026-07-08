import { config } from "../../config.js";
import { dolibarrId, numberOrUndefined } from "./normalization.js";

export type DeleteDryRun = {
  delete_enabled: true;
  dry_run: true;
  would_delete: true;
  entity_type: string;
  id: number;
  ref?: string;
  name?: string;
  status?: string;
  linked?: Record<string, number | "unavailable">;
};

export function deletesDisabledResponse(): Record<string, unknown> | undefined {
  if (config.mcpAllowDeletes) return undefined;

  return {
    error: "DELETES_DISABLED",
    message: "Deletes are disabled in this environment. Set MCP_ALLOW_DELETES=true to enable guarded delete tools.",
  };
}

export function deleteDryRun(value: Omit<DeleteDryRun, "delete_enabled" | "dry_run" | "would_delete">): DeleteDryRun {
  return {
    delete_enabled: true,
    dry_run: true,
    would_delete: true,
    ...value,
  };
}

export function cleanId(value: unknown): number {
  return dolibarrId(value);
}

export function statusCode(value: unknown): number {
  return numberOrUndefined(value) ?? -1;
}

export function mustReopenResponse(
  entity: string,
  ref: string | undefined,
  reopenFlag: string,
): Record<string, unknown> {
  const label = ref ? `${entity} ${ref}` : entity;
  return {
    error: "MUST_REOPEN",
    message: `${label} is not draft. Re-run with ${reopenFlag}:true, or set it to draft first.`,
  };
}
