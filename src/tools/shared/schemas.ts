import { z } from "zod";

export const lineSchema = z.object({
  product_ref: z.string().optional().describe("Existing Dolibarr product/service reference, such as EXAMPLE-SERVICE"),
  description: z.string().optional().describe("Free-text line description. Leave empty when using product_ref to let Dolibarr copy the catalog description."),
  product_type: z.union([z.literal(0), z.literal(1)]).optional().describe("Free-text line type: 0 for a product, 1 for a service. Defaults to product (0). Catalog lines inherit their type."),
  qty: z.number().positive(),
  unit_price: z.number().optional().describe("Unit price excl. tax. Required for free-text lines, optional override for catalog lines."),
  vat_rate: z.number().optional().describe("VAT rate. Required for free-text lines, optional override for catalog lines."),
}).refine((line) => line.product_ref || line.description, {
  message: "Either product_ref or description is required.",
});
