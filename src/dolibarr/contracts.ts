import { dolibarr } from "./client.js";
import { isDolibarrNotFoundError } from "./errors.js";
import { dolibarrQueryString } from "./sqlFilters.js";
import { listAllPages } from "./pagination.js";
import type { DolibarrContract, DolibarrContractLine } from "../types/dolibarr.js";

// GET /contracts/{id} returns lines and, unlike the list endpoint, the
// linkedObjectsIds that point at invoices.
export async function getContract(id: number): Promise<DolibarrContract> {
  return dolibarr.get<DolibarrContract>(`/contracts/${id}`);
}

export async function listContracts(params: string): Promise<DolibarrContract[]> {
  try {
    return await dolibarr.get<DolibarrContract[]>(`/contracts?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

// Every contract with its lines, optionally for one thirdparty. The list
// endpoint carries no linkedObjectsIds; fetch those per contract with getContract.
export async function listAllContracts(options: { thirdpartyId?: number } = {}): Promise<DolibarrContract[]> {
  return listAllPages((page, pageSize) =>
    listContracts(dolibarrQueryString({
      sortfield: "t.rowid",
      sortorder: "ASC",
      limit: String(pageSize),
      page: String(page),
      withLines: "true",
      ...(options.thirdpartyId !== undefined ? { thirdparty_ids: String(options.thirdpartyId) } : {}),
    })),
  );
}

// Dolibarr requires the signing and follow-up representative on creation.
export async function createContract(data: {
  socid: number;
  date_contrat: number;
  commercial_signature_id: number;
  commercial_suivi_id: number;
  ref_customer?: string;
}): Promise<number> {
  return dolibarr.post<number>("/contracts", data);
}

export async function addContractLine(
  contractId: number,
  line: Partial<DolibarrContractLine> & { desc: string },
): Promise<number> {
  return dolibarr.post<number>(`/contracts/${contractId}/lines`, line);
}

export async function validateContract(contractId: number): Promise<void> {
  // An empty body is rejected with 403 by Dolibarr, so always send notrigger.
  await dolibarr.post(`/contracts/${contractId}/validate`, { notrigger: 0 });
}

export async function activateContractLine(
  contractId: number,
  lineId: number,
  data: { datestart: number; dateend?: number; comment?: string },
): Promise<void> {
  await dolibarr.put(`/contracts/${contractId}/lines/${lineId}/activate`, data);
}

// Despite its name, Dolibarr's "unactivate" route closes the service line
// (status 5, closing date set); it does not return it to "not started".
export async function unactivateContractLine(
  contractId: number,
  lineId: number,
  data: { datestart: number; comment?: string },
): Promise<void> {
  await dolibarr.put(`/contracts/${contractId}/lines/${lineId}/unactivate`, data);
}

// Closes all service lines of the contract.
export async function closeContract(contractId: number): Promise<void> {
  await dolibarr.post(`/contracts/${contractId}/close`, { notrigger: 0 });
}
