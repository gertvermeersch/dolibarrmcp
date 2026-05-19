import { dolibarr } from "./client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "./sqlFilters.js";
import type { DolibarrThirdparty } from "../types/dolibarr.js";

export async function searchThirdparties(query: string): Promise<DolibarrThirdparty[]> {
  const params = dolibarrQueryString({
    sqlfilters: `(t.nom:like:${dolibarrLikeLiteral(query)})`,
    limit: "10",
  });

  return dolibarr.get<DolibarrThirdparty[]>(`/thirdparties?${params}`);
}

export async function getThirdparty(id: number): Promise<DolibarrThirdparty> {
  return dolibarr.get<DolibarrThirdparty>(`/thirdparties/${id}`);
}

export async function createThirdparty(
  data: Partial<DolibarrThirdparty>,
): Promise<number> {
  return dolibarr.post<number>("/thirdparties", data);
}

export async function updateThirdparty(
  id: number,
  data: Partial<DolibarrThirdparty>,
): Promise<DolibarrThirdparty> {
  return dolibarr.put<DolibarrThirdparty>(`/thirdparties/${id}`, data);
}
