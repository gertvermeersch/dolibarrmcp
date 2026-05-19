import { z } from "zod";

export const lineSchema = z.object({
  description: z.string(),
  qty: z.number().positive(),
  unit_price: z.number().optional(),
  vat_rate: z.number().optional(),
});
