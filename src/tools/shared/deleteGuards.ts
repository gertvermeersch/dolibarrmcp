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

export interface GuardedDeleteOptions<T extends { ref?: string; statut?: unknown }> {
  /** Machine-facing entity type in the dry-run payload, e.g. "invoice". */
  entityType: string;
  /** Human-facing entity label in the must-reopen message, e.g. "Invoice". */
  entityLabel: string;
  /** Response key for the deleted document's ID, e.g. "invoice_id". */
  idKey: string;
  /** Input flag name to suggest when a non-draft document must be reopened. */
  reopenFlag: string;
  id: number;
  confirm: boolean;
  /** Whether the caller opted in to reopening a non-draft document. */
  reopen: boolean;
  fetch: (id: number) => Promise<T>;
  statusLabel: (entity: T) => string | undefined;
  /** Reopen a non-draft document to draft; captures entity-specific options. */
  reopenToDraft: (id: number) => Promise<unknown>;
  remove: (id: number) => Promise<void>;
}

/**
 * Run the shared guarded document delete flow: enablement check, dry run,
 * draft/reopen guard, delete, and success response. Entity-specific concerns
 * (reopen options, status labels, ID field name) are supplied by the caller.
 */
export async function runGuardedDelete<T extends { ref?: string; statut?: unknown }>(
  options: GuardedDeleteOptions<T>,
): Promise<Record<string, unknown>> {
  const disabled = deletesDisabledResponse();
  if (disabled) return disabled;

  const entity = await options.fetch(options.id);

  if (!options.confirm) {
    return deleteDryRun({
      entity_type: options.entityType,
      id: options.id,
      ref: entity.ref,
      status: options.statusLabel(entity),
    });
  }

  if (statusCode(entity.statut) !== 0) {
    if (!options.reopen) {
      return mustReopenResponse(options.entityLabel, entity.ref, options.reopenFlag);
    }

    await options.reopenToDraft(options.id);
  }

  await options.remove(options.id);

  return {
    success: true,
    deleted: true,
    [options.idKey]: options.id,
  };
}
