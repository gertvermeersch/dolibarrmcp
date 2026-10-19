import { getContract, listContracts } from "../dolibarr/contracts.js";
import { resolveByIdOrRef } from "../tools/shared/resolveByIdOrRef.js";
import type { DolibarrContract } from "../types/dolibarr.js";
import type { McpError } from "../types/tools.js";

export type ContractResolveResult =
  | { ok: true; contract: DolibarrContract }
  | { ok: false; error: McpError };

// Contracts are addressed by Dolibarr ID or exact ref (for example CT2501-0003).
export async function resolveContract(value: string): Promise<ContractResolveResult> {
  const contract = await resolveByIdOrRef(value, { getById: getContract, list: listContracts });

  if (!contract) {
    return {
      ok: false,
      error: {
        error: "CONTRACT_NOT_FOUND",
        message: `No contract found for '${value}'.`,
        action: "Run list_contracts_by_expiry or search_across to find the contract ref or ID.",
      },
    };
  }

  return { ok: true, contract };
}
