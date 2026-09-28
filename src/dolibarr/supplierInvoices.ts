import { dolibarr } from "./client.js";
import type {
  DolibarrInvoice,
  DolibarrInvoiceLine,
  DolibarrInvoicePayment,
} from "../types/dolibarr.js";

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

export async function updateSupplierInvoice(
  invoiceId: number,
  fields: Record<string, unknown>,
): Promise<DolibarrInvoice> {
  return dolibarr.put<DolibarrInvoice>(`/supplierinvoices/${invoiceId}`, fields);
}

// Dolibarr resets any field missing from the body; pass a full line built with
// mergeLineUpdate rather than a partial change set.
export async function updateSupplierInvoiceLine(
  invoiceId: number,
  lineId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<void> {
  await dolibarr.put(`/supplierinvoices/${invoiceId}/lines/${lineId}`, {
    ...line,
    description: line.desc,
    pu_ht: line.subprice,
  });
}

export async function deleteSupplierInvoiceLine(invoiceId: number, lineId: number): Promise<void> {
  await dolibarr.delete(`/supplierinvoices/${invoiceId}/lines/${lineId}`);
}

export async function validateSupplierInvoice(
  invoiceId: number,
  options: { notrigger?: number } = {},
): Promise<void> {
  await dolibarr.post(`/supplierinvoices/${invoiceId}/validate`, {
    notrigger: options.notrigger ?? 0,
  });
}

export async function getSupplierInvoicePayments(
  invoiceId: number,
): Promise<DolibarrInvoicePayment[]> {
  return dolibarr.get<DolibarrInvoicePayment[]>(`/supplierinvoices/${invoiceId}/payments`);
}

export async function createSupplierInvoicePayment(
  invoiceId: number,
  data: {
    datepaye: number;
    payment_mode_id: number;
    accountid: number;
    num_payment?: string;
    comment?: string;
    chqemetteur?: string;
    chqbank?: string;
  },
): Promise<number> {
  return dolibarr.post<number>(`/supplierinvoices/${invoiceId}/payments`, {
    ...data,
    closepaidinvoices: "yes",
  });
}

export async function setSupplierInvoicePaid(
  invoiceId: number,
  options: { closeCode?: string; closeNote?: string } = {},
): Promise<DolibarrInvoice> {
  return dolibarr.post<DolibarrInvoice>(`/supplierinvoices/${invoiceId}/settopaid`, {
    close_code: options.closeCode ?? "",
    close_note: options.closeNote ?? "",
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
