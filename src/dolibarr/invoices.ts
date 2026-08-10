import { dolibarr } from "./client.js";
import { config } from "../config.js";
import type {
  DolibarrInvoice,
  DolibarrInvoiceLine,
  DolibarrInvoicePayment,
} from "../types/dolibarr.js";

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

export async function validateInvoice(
  invoiceId: number,
  options: { notrigger?: number } = {},
): Promise<void> {
  await dolibarr.post(`/invoices/${invoiceId}/validate`, { notrigger: options.notrigger ?? 0 });
}

export async function getInvoicePayments(invoiceId: number): Promise<DolibarrInvoicePayment[]> {
  return dolibarr.get<DolibarrInvoicePayment[]>(`/invoices/${invoiceId}/payments`);
}

export async function createInvoicePayment(
  invoiceId: number,
  data: {
    datepaye: number;
    paymentid: number;
    accountid: number;
    num_payment?: string;
    comment?: string;
    chqemetteur?: string;
    chqbank?: string;
  },
): Promise<number> {
  return dolibarr.post<number>(`/invoices/${invoiceId}/payments`, {
    ...data,
    closepaidinvoices: "yes",
  });
}

export async function setInvoicePaid(
  invoiceId: number,
  options: { closeCode?: string; closeNote?: string } = {},
): Promise<DolibarrInvoice> {
  return dolibarr.post<DolibarrInvoice>(`/invoices/${invoiceId}/settopaid`, {
    close_code: options.closeCode ?? "",
    close_note: options.closeNote ?? "",
  });
}

export async function setInvoiceDraft(
  invoiceId: number,
  options: { warehouseId?: number } = {},
): Promise<DolibarrInvoice> {
  return dolibarr.post<DolibarrInvoice>(`/invoices/${invoiceId}/settodraft`, {
    idwarehouse: options.warehouseId ?? config.dolibarrDefaultWarehouseId ?? -1,
  });
}

export async function deleteInvoice(id: number): Promise<void> {
  await dolibarr.delete<void>(`/invoices/${id}`);
}
