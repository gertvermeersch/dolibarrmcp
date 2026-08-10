import { dolibarr } from "./client.js";
import type { DolibarrInvoice, DolibarrInvoiceLine } from "../types/dolibarr.js";

export async function getSupplierInvoice(id: number): Promise<DolibarrInvoice> {
  return dolibarr.get<DolibarrInvoice>(`/supplierinvoices/${id}?includeLines=1`);
}

export async function listSupplierInvoices(params: string): Promise<DolibarrInvoice[]> {
  return dolibarr.get<DolibarrInvoice[]>(`/supplierinvoices?${params}`);
}

export async function createSupplierInvoice(data: {
  socid: number;
  date: number;
  ref_supplier?: string;
  lines?: Partial<DolibarrInvoiceLine>[];
}): Promise<number> {
  return dolibarr.post<number>("/supplierinvoices", { ref: "auto", ...data });
}

export async function addSupplierInvoiceLine(
  invoiceId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<number> {
  return dolibarr.post<number>(`/supplierinvoices/${invoiceId}/lines`, {
    ...line,
    description: line.desc,
    pu_ht: line.subprice,
  });
}

export async function validateSupplierInvoice(
  invoiceId: number,
  options: { notrigger?: number } = {},
): Promise<void> {
  await dolibarr.post(`/supplierinvoices/${invoiceId}/validate`, {
    notrigger: options.notrigger ?? 0,
  });
}

export async function setSupplierInvoiceDraft(
  invoiceId: number,
  options: { notrigger?: number } = {},
): Promise<DolibarrInvoice> {
  return dolibarr.post<DolibarrInvoice>(`/supplierinvoices/${invoiceId}/settodraft`, {
    notrigger: options.notrigger ?? 0,
  });
}

export async function deleteSupplierInvoice(id: number): Promise<void> {
  await dolibarr.delete<void>(`/supplierinvoices/${id}`);
}
