import { dolibarr } from "./client.js";
import type { DolibarrProduct } from "../types/dolibarr.js";

export async function searchProducts(query: string): Promise<DolibarrProduct[]> {
  return dolibarr.get<DolibarrProduct[]>(
    `/products?sqlfilters=(t.ref%3Alike%3A'%25${encodeURIComponent(query)}%25')%20OR%20(t.label%3Alike%3A'%25${encodeURIComponent(query)}%25')&limit=10`,
  );
}
