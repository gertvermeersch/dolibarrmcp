import { dolibarr } from "./client.js";
import type { DolibarrInvoice, DolibarrInvoiceLine } from "../types/dolibarr.js";

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

export async function validateSupplierInvoice(invoiceId: number): Promise<void> {
  await dolibarr.post(`/supplierinvoices/${invoiceId}/validate`, {});
}
