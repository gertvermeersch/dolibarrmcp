import { z } from "zod";

export const lineSchema = z.object({
  product_ref: z.string().optional().describe("Existing Dolibarr product/service reference, such as EXAMPLE-SERVICE"),
  description: z.string().optional().describe("Free-text line description. Leave empty when using product_ref to let Dolibarr copy the catalog description."),
  product_type: z.enum(["product", "service"]).optional().describe("Free-text line type. Defaults to product. Catalog lines inherit their type."),
  qty: z.number().positive(),
  unit_price: z.number().optional().describe("Unit price excl. tax. Required for free-text lines, optional override for catalog lines."),
  vat_rate: z.number().optional().describe("VAT rate. Required for free-text lines, optional override for catalog lines."),
}).refine((line) => line.product_ref || line.description, {
  message: "Either product_ref or description is required.",
});

export const lineUpdateSchema = z.object({
  line_id: z.number().int().positive().describe("Existing line ID, as returned in the document detail's lines[].line_id"),
  description: z.string().optional(),
  qty: z.number().positive().optional(),
  unit_price: z.number().optional().describe("Unit price excl. tax"),
  vat_rate: z.number().optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  product_type: z.enum(["product", "service"]).optional(),
});

// Shared line-edit inputs for draft document update tools. Fields left out of
// a line update keep their current value.
export const documentLineEditsSchema = {
  update_lines: z.array(lineUpdateSchema).default([]).describe("Edit existing lines; omitted fields keep their current value"),
  add_lines: z.array(lineSchema).default([]).describe("Lines to append, same shape as the create tool's lines"),
  remove_line_ids: z.array(z.number().int().positive()).default([]).describe("Line IDs to delete"),
};
