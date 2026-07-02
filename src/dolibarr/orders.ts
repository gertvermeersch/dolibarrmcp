import { dolibarr, isDolibarrNotFoundError, type DolibarrRequestOptions } from "./client.js";
import type { DolibarrOrder } from "../types/dolibarr.js";

export async function listOrders(
  params: string,
  options: DolibarrRequestOptions = {},
): Promise<DolibarrOrder[]> {
  try {
    return await dolibarr.get<DolibarrOrder[]>(`/orders?${params}`, options);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}
