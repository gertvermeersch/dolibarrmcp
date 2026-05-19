import { dolibarr } from "./client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "./sqlFilters.js";
import type { DolibarrProduct } from "../types/dolibarr.js";

export async function searchProducts(query: string): Promise<DolibarrProduct[]> {
  const search = dolibarrLikeLiteral(query);
  const params = dolibarrQueryString({
    sqlfilters: `(t.ref:like:${search}) OR (t.label:like:${search})`,
    limit: "10",
  });
  console.log(`/products?${params}`);
  return dolibarr.get<DolibarrProduct[]>(`/products?${params}`);
}
