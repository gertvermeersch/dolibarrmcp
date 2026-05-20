import { searchCatalogItems } from "../dolibarr/products.js";
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
  if (input.product_ref) {
    const products = await searchCatalogItems(input.product_ref);
    const product =
      products.find((p) => p.ref === input.product_ref) ??
      (products.length === 1 ? products[0] : undefined);

    if (!product) {
      return {
        ok: false,
        error: {
          index,
          error: `Line ${index}: product/service reference '${input.product_ref}' did not match exactly one catalog item.`,
        },
      };
    }

    const line: Partial<DolibarrInvoiceLine> = {
      fk_product: product.id,
      product_ref: product.ref,
      qty: input.qty,
      subprice: input.unit_price ?? product.price,
      tva_tx: input.vat_rate ?? product.tva_tx,
    };

    if (input.description) line.desc = input.description;

    return {
      ok: true,
      resolved: {
        line,
        resolution: {
          index,
          resolved: true,
          product_ref: product.ref,
          label: product.label,
        },
      },
    };
  }

  // Free-text lines have no catalog product, so Dolibarr needs price and VAT explicitly.
  if (!input.description || input.unit_price === undefined || input.vat_rate === undefined) {
    return {
      ok: false,
      error: {
        index,
        error: `Line ${index}: description, unit_price, and vat_rate are required for free-text lines.`,
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
