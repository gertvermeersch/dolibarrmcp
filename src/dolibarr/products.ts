import { dolibarr, isDolibarrNotFoundError } from "./client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "./sqlFilters.js";
import type { DolibarrProduct } from "../types/dolibarr.js";

type CatalogSearchMode = "all" | "products" | "services";

const catalogModeParam: Record<CatalogSearchMode, string> = {
  all: "0",
  products: "1",
  services: "2",
};

async function searchCatalog(query: string, mode: CatalogSearchMode): Promise<DolibarrProduct[]> {
  const search = dolibarrLikeLiteral(query);
  const params = dolibarrQueryString({
    sqlfilters: `(t.ref:like:${search}) OR (t.label:like:${search})`,
    limit: "10",
    mode: catalogModeParam[mode],
  });
  try {
    return await dolibarr.get<DolibarrProduct[]>(`/products?${params}`);
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return [];
    throw err;
  }
}

export async function searchCatalogItems(query: string): Promise<DolibarrProduct[]> {
  return searchCatalog(query, "all");
}

export async function searchProducts(query: string): Promise<DolibarrProduct[]> {
  return searchCatalog(query, "products");
}

export async function searchServices(query: string): Promise<DolibarrProduct[]> {
  return searchCatalog(query, "services");
}
