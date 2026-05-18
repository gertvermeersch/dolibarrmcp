import { dolibarr } from "./client.js";
import type { DolibarrInvoice, DolibarrInvoiceLine } from "../types/dolibarr.js";

export async function getInvoice(id: number): Promise<DolibarrInvoice> {
  return dolibarr.get<DolibarrInvoice>(`/invoices/${id}?includeLines=1`);
}

export async function listInvoices(params: string): Promise<DolibarrInvoice[]> {
  return dolibarr.get<DolibarrInvoice[]>(`/invoices?${params}`);
}

export async function createInvoice(data: {
  socid: number;
  date: number;
  lines?: Partial<DolibarrInvoiceLine>[];
}): Promise<number> {
  return dolibarr.post<number>("/invoices", data);
}

export async function addInvoiceLine(
  invoiceId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<number> {
  return dolibarr.post<number>(`/invoices/${invoiceId}/lines`, line);
}

export async function validateInvoice(invoiceId: number): Promise<void> {
  await dolibarr.post(`/invoices/${invoiceId}/validate`, {});
}
