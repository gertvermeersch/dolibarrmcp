import { dolibarr, isDolibarrNotFoundError } from "./client.js";
import type { DolibarrOrder } from "../types/dolibarr.js";

export async function listOrders(params: string): Promise<DolibarrOrder[]> {
  try {
    return await dolibarr.get<DolibarrOrder[]>(`/orders?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}
