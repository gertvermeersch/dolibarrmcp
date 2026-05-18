import { searchProducts } from "../dolibarr/products.js";
import type { LineItemInput, LineResolution } from "../types/tools.js";
import type { DolibarrInvoiceLine } from "../types/dolibarr.js";

export interface ResolvedLine {
  line: Partial<DolibarrInvoiceLine>;
  resolution: LineResolution;
}

export interface ResolveLineError {
  index: number;
  error: string;
}

export type ResolveLineResult =
  | { ok: true; resolved: ResolvedLine }
  | { ok: false; error: ResolveLineError };

export async function resolveLine(
  input: LineItemInput,
  index: number,
): Promise<ResolveLineResult> {
  const products = await searchProducts(input.description);

  if (products.length === 1) {
    const p = products[0];
    return {
      ok: true,
      resolved: {
        line: {
          fk_product: p.id,
          product_ref: p.ref,
          desc: p.label,
          qty: input.qty,
          subprice: input.unit_price ?? p.price,
          tva_tx: input.vat_rate ?? p.tva_tx,
        },
        resolution: {
          index,
          resolved: true,
          product_ref: p.ref,
          label: p.label,
        },
      },
    };
  }

  // No catalog match — free text, price and VAT required
  if (!input.unit_price || input.vat_rate === undefined) {
    return {
      ok: false,
      error: {
        index,
        error: `Line ${index}: '${input.description}' did not match a catalog product. unit_price and vat_rate are required for free-text lines.`,
      },
    };
  }

  return {
    ok: true,
    resolved: {
      line: {
        desc: input.description,
        qty: input.qty,
        subprice: input.unit_price,
        tva_tx: input.vat_rate,
      },
      resolution: {
        index,
        resolved: false,
        label: input.description,
        note: "Added as free text",
      },
    },
  };
}
