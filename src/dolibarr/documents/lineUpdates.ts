import type { DolibarrInvoiceLine } from "../../types/dolibarr.js";

export interface LineChanges {
  description?: string;
  qty?: number;
  unit_price?: number;
  vat_rate?: number;
  discount_percent?: number;
  product_type?: "product" | "service";
}

export type LineUpdatePayload = Partial<DolibarrInvoiceLine> & Record<string, unknown>;

// Line fields Dolibarr's PUT {id}/lines/{lineid} handlers forward positionally
// to updateline(). Invoice and supplier invoice handlers pass missing fields as
// null, which resets price, VAT, discount, description, and service periods, so
// every update must resend the existing values. Verified on Dolibarr 24.0.0.
// multicurrency_subprice is deliberately omitted so Dolibarr recomputes it from
// subprice instead of keeping a stale foreign-currency price.
const preservedLineFields = [
  "desc",
  "label",
  "qty",
  "subprice",
  "tva_tx",
  "localtax1_tx",
  "localtax2_tx",
  "remise_percent",
  "product_type",
  "fk_product",
  "date_start",
  "date_end",
  "info_bits",
  "special_code",
  "fk_parent_line",
  "fk_fournprice",
  "pa_ht",
  "fk_unit",
  "situation_percent",
  "ref_ext",
  // Supplier invoice lines only: the supplier's product reference.
  "ref_supplier",
  "rang",
] as const;

export function hasLineChanges(changes: LineChanges): boolean {
  return Object.values(changes).some((value) => value !== undefined);
}

/**
 * Build a complete line update payload from the current Dolibarr line and the
 * requested changes. Keys use the client invoice/proposal names (desc,
 * subprice); supplier invoice helpers map them to their own field names.
 */
export function mergeLineUpdate(existing: DolibarrInvoiceLine, changes: LineChanges): LineUpdatePayload {
  const raw = existing as DolibarrInvoiceLine & Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  for (const field of preservedLineFields) {
    const value = raw[field];
    if (value !== undefined && value !== null) payload[field] = value;
  }

  // Supplier invoice lines may only expose the description under its own name.
  if (payload.desc === undefined && typeof raw.description === "string") {
    payload.desc = raw.description;
  }
  if (payload.subprice === undefined && raw.pu_ht !== undefined && raw.pu_ht !== null) {
    payload.subprice = Number(raw.pu_ht);
  }

  if (changes.description !== undefined) payload.desc = changes.description;
  if (changes.qty !== undefined) payload.qty = changes.qty;
  if (changes.unit_price !== undefined) payload.subprice = changes.unit_price;
  if (changes.vat_rate !== undefined) payload.tva_tx = changes.vat_rate;
  if (changes.discount_percent !== undefined) payload.remise_percent = changes.discount_percent;
  if (changes.product_type !== undefined) payload.product_type = changes.product_type === "service" ? 1 : 0;

  return payload as LineUpdatePayload;
}
