import { dolibarr } from "./client.js";
import type { DolibarrThirdparty } from "../types/dolibarr.js";

export async function searchThirdparties(query: string): Promise<DolibarrThirdparty[]> {
  return dolibarr.get<DolibarrThirdparty[]>(
    `/thirdparties?sqlfilters=(t.nom%3Alike%3A'%25${encodeURIComponent(query)}%25')&limit=10`,
  );
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
