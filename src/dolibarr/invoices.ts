import { dolibarr } from "./client.js";
import { config } from "../config.js";
import { numberOrUndefined } from "../tools/shared/normalization.js";
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
  // Forces the due date; Dolibarr otherwise derives it from the payment terms.
  date_lim_reglement?: number;
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

/**
 * Build the PUT body for an invoice header update. A PUT that changes `date`
 * keeps the old due date, while the Dolibarr UI recomputes it from the payment
 * terms. The API recomputes it when `cond_reglement_id` is posted after `date`,
 * so a date change without an explicit due date resends the current terms.
 * Without payment terms Dolibarr's calculation falls back to the invoice date.
 */
export function invoiceHeaderUpdateBody(
  fields: Record<string, unknown>,
  current: DolibarrInvoice,
): Record<string, unknown> {
  if (fields.date === undefined || fields.date_lim_reglement !== undefined) return fields;

  const paymentTermsId = numberOrUndefined(current.cond_reglement_id);
  return paymentTermsId !== undefined && paymentTermsId > 0
    ? { ...fields, cond_reglement_id: paymentTermsId }
    : { ...fields, date_lim_reglement: fields.date };
}

export async function updateInvoice(
  invoiceId: number,
  fields: Record<string, unknown>,
  current: DolibarrInvoice,
): Promise<DolibarrInvoice> {
  return dolibarr.put<DolibarrInvoice>(
    `/invoices/${invoiceId}`,
    invoiceHeaderUpdateBody(fields, current),
  );
}

// Dolibarr resets any field missing from the body; pass a full line built with
// mergeLineUpdate rather than a partial change set.
export async function updateInvoiceLine(
  invoiceId: number,
  lineId: number,
  line: Partial<DolibarrInvoiceLine>,
): Promise<void> {
  await dolibarr.put(`/invoices/${invoiceId}/lines/${lineId}`, line);
}

export async function deleteInvoiceLine(invoiceId: number, lineId: number): Promise<void> {
  await dolibarr.delete(`/invoices/${invoiceId}/lines/${lineId}`);
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
