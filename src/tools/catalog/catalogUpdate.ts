import { z } from "zod";
import { getProduct, listProducts, updateProduct } from "../../dolibarr/products.js";
import type { DolibarrProduct } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";
import { dolibarrId, money, numberOrUndefined } from "../shared/normalization.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import { serializeCatalogItemDetail } from "../shared/serializers.js";

export type CatalogKind = "product" | "service";

export interface CatalogUpdateInput {
  item: string;
  ref?: string;
  label?: string;
  description?: string;
  price?: number;
  vat_rate?: number;
  on_sale?: boolean;
  on_purchase?: boolean;
  note_public?: string;
  note_private?: string;
}

export interface CatalogApi {
  get(id: number): Promise<DolibarrProduct>;
  list(params: string): Promise<DolibarrProduct[]>;
  update(id: number, fields: Record<string, unknown>): Promise<DolibarrProduct>;
}

const defaultCatalogApi: CatalogApi = { get: getProduct, list: listProducts, update: updateProduct };

const catalogTypeCode: Record<CatalogKind, number> = { product: 0, service: 1 };

function flag(value: boolean | undefined): number | undefined {
  return value === undefined ? undefined : value ? 1 : 0;
}

/**
 * Update a catalog product or service. Only posted fields change in Dolibarr.
 * The item's type is never changed: Dolibarr's API would silently convert a
 * service into a product, so a mismatch between tool and item is refused.
 */
export async function updateCatalogItem(
  kind: CatalogKind,
  input: CatalogUpdateInput,
  api: CatalogApi = defaultCatalogApi,
): Promise<Record<string, unknown> | McpError> {
  const { item: itemInput, ...changes } = input;
  const idKey = `${kind}_id`;

  const item = await resolveByIdOrRef(itemInput, { getById: api.get, list: api.list });
  if (!item) {
    return {
      error: kind === "service" ? "SERVICE_NOT_FOUND" : "PRODUCT_NOT_FOUND",
      message: `No ${kind} found for '${itemInput}'.`,
    };
  }

  if (numberOrUndefined(item.type) !== catalogTypeCode[kind]) {
    const actual = kind === "service" ? "product" : "service";
    return {
      error: "CATALOG_TYPE_MISMATCH",
      message: `'${item.ref}' is a ${actual}, not a ${kind}.`,
      action: `Use update_${actual} for this item.`,
    };
  }

  const fields = Object.fromEntries(
    Object.entries({
      ref: changes.ref,
      label: changes.label,
      description: changes.description,
      price: changes.price,
      tva_tx: changes.vat_rate,
      status: flag(changes.on_sale),
      status_buy: flag(changes.on_purchase),
      note_public: changes.note_public,
      note_private: changes.note_private,
    }).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(fields).length === 0) {
    return { error: "VALIDATION_ERROR", message: "No changes requested." };
  }

  // Keep the price basis explicit so a price change is read as excl. tax.
  if (fields.price !== undefined) fields.price_base_type = "HT";

  const id = dolibarrId(item.id);
  await api.update(id, fields);
  const updated = await api.get(id);

  // Price and VAT changes are dropped silently in per-segment or per-quantity
  // pricing modes, which this API user cannot detect up front.
  const warnings: string[] = [];
  if (changes.price !== undefined && money(updated.price) !== money(changes.price)) {
    warnings.push("Dolibarr did not apply the price change. The instance likely uses per-segment or per-quantity pricing, which this tool does not manage.");
  }
  if (changes.vat_rate !== undefined && numberOrUndefined(updated.tva_tx) !== changes.vat_rate) {
    warnings.push("Dolibarr did not apply the VAT rate change. The instance likely uses per-segment or per-quantity pricing, which this tool does not manage.");
  }

  return {
    success: true,
    [idKey]: id,
    updated_fields: Object.keys(changes).filter(
      (field) => changes[field as keyof typeof changes] !== undefined,
    ),
    ...(warnings.length > 0 ? { warnings } : {}),
    [kind]: serializeCatalogItemDetail(updated),
  };
}

// Update fields shared by update_product and update_service.
export const catalogUpdateFieldsSchema = {
  ref: z.string().min(1).optional().describe("New reference. Must be unique in the catalog."),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional().describe("Selling price excl. tax"),
  vat_rate: z.number().min(0).optional(),
  on_sale: z.boolean().optional().describe("Whether it can be sold"),
  on_purchase: z.boolean().optional().describe("Whether it can be purchased"),
  note_public: z.string().optional(),
  note_private: z.string().optional(),
};
