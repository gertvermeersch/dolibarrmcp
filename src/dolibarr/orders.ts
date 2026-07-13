import { dolibarr, type DolibarrRequestOptions } from "./client.js";
import { isDolibarrNotFoundError } from "./errors.js";
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

export async function getOrder(id: number): Promise<DolibarrOrder> {
  return dolibarr.get<DolibarrOrder>(`/orders/${id}?includeLines=1`);
}
