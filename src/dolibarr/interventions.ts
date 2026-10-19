import { dolibarr } from "./client.js";
import { isDolibarrNotFoundError } from "./errors.js";
import { dolibarrQueryString } from "./sqlFilters.js";
import { listAllPages } from "./pagination.js";
import type { DolibarrIntervention } from "../types/dolibarr.js";

export async function getIntervention(id: number): Promise<DolibarrIntervention> {
  return dolibarr.get<DolibarrIntervention>(`/interventions/${id}`);
}

export async function listInterventions(params: string): Promise<DolibarrIntervention[]> {
  try {
    return await dolibarr.get<DolibarrIntervention[]>(`/interventions?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

// Every intervention, optionally narrowed by thirdparty or contract server-side.
// Status and date filters are applied by callers: they depend on line dates,
// which Dolibarr's sqlfilters cannot reach.
export async function listAllInterventions(
  options: { thirdpartyId?: number; contractId?: number } = {},
): Promise<DolibarrIntervention[]> {
  return listAllPages((page, pageSize) =>
    listInterventions(dolibarrQueryString({
      sortfield: "t.rowid",
      sortorder: "ASC",
      limit: String(pageSize),
      page: String(page),
      ...(options.thirdpartyId !== undefined ? { thirdparty_ids: String(options.thirdpartyId) } : {}),
      ...(options.contractId !== undefined ? { sqlfilters: `(t.fk_contrat:=:${options.contractId})` } : {}),
    })),
  );
}

// POST /interventions requires fk_project; 0 means "no project".
export async function createIntervention(data: {
  socid: number;
  fk_project: number;
  description: string;
  fk_contrat: number;
}): Promise<number> {
  return dolibarr.post<number>("/interventions", data);
}

export async function addInterventionLine(
  interventionId: number,
  line: { description: string; date: number; duration: number },
): Promise<number> {
  return dolibarr.post<number>(`/interventions/${interventionId}/lines`, line);
}

export async function validateIntervention(interventionId: number): Promise<void> {
  await dolibarr.post(`/interventions/${interventionId}/validate`, { notrigger: 0 });
}

// Closing marks the intervention as done (status 3).
export async function closeIntervention(interventionId: number): Promise<void> {
  await dolibarr.post(`/interventions/${interventionId}/close`, { notrigger: 0 });
}
