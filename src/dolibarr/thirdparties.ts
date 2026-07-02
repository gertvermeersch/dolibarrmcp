import { dolibarr, isDolibarrNotFoundError, type DolibarrRequestOptions } from "./client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "./sqlFilters.js";
import type { DolibarrContact, DolibarrThirdparty } from "../types/dolibarr.js";

export type ThirdpartySearchKind = "all" | "clients" | "suppliers";

const thirdpartyModeParam: Record<ThirdpartySearchKind, string> = {
  all: "0",
  clients: "1",
  suppliers: "4",
};

export function getThirdpartySupplierFlag(thirdparty: DolibarrThirdparty): number {
  return Number(thirdparty.supplier ?? thirdparty.fournisseur ?? 0);
}

export function getThirdpartyClientFlag(thirdparty: DolibarrThirdparty): number {
  return Number(thirdparty.client ?? 0);
}

export function getThirdpartyType(thirdparty: DolibarrThirdparty): "client" | "supplier" | "both" | "other" {
  const isClient = getThirdpartyClientFlag(thirdparty) > 0;
  const isSupplier = getThirdpartySupplierFlag(thirdparty) > 0;

  if (isClient && isSupplier) {
    return "both";
  }

  if (isSupplier) {
    return "supplier";
  }

  if (isClient) {
    return "client";
  }

  return "other";
}

export async function searchThirdparties(
  query: string,
  kind: ThirdpartySearchKind = "all",
): Promise<DolibarrThirdparty[]> {
  const search = dolibarrLikeLiteral(query);

  const params = dolibarrQueryString({
    sqlfilters: `(t.nom:like:${search}) OR (t.code_client:like:${search}) OR (t.code_fournisseur:like:${search})`,
    limit: "10",
    mode: thirdpartyModeParam[kind],
  });

  try {
    return await dolibarr.get<DolibarrThirdparty[]>(`/thirdparties?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

export async function getThirdparty(
  id: number,
  options: DolibarrRequestOptions = {},
): Promise<DolibarrThirdparty> {
  return dolibarr.get<DolibarrThirdparty>(`/thirdparties/${id}`, options);
}

export async function getThirdpartyContacts(id: number): Promise<DolibarrContact[]> {
  try {
    return await dolibarr.get<DolibarrContact[]>(`/thirdparties/${id}/contacts`, {
      suppressErrorStatuses: [404],
    });
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
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

export async function deleteThirdparty(id: number): Promise<void> {
  await dolibarr.delete<void>(`/thirdparties/${id}`);
}
