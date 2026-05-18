import { dolibarr } from "./client.js";
import type { DolibarrInvoice, DolibarrInvoiceLine } from "../types/dolibarr.js";

export async function createSupplierInvoice(data: {
  socid: number;
  date: number;
  lines?: Partial<DolibarrInvoiceLine>[];
}): Promise<number> {
  return dolibarr.post<number>("/fourn/invoices", data);
}

export async function addSupplierInvoiceLine(
  invoiceId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<number> {
  return dolibarr.post<number>(`/fourn/invoices/${invoiceId}/lines`, line);
}

export async function validateSupplierInvoice(invoiceId: number): Promise<void> {
  await dolibarr.post(`/fourn/invoices/${invoiceId}/validate`, {});
}
