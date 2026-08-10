import { DolibarrApiError } from "../errors.js";
import {
  createInvoicePayment,
  getInvoice,
  getInvoicePayments,
  setInvoicePaid,
} from "../invoices.js";
import {
  createSupplierInvoicePayment,
  getSupplierInvoice,
  getSupplierInvoicePayments,
  setSupplierInvoicePaid,
} from "../supplierInvoices.js";
import type { DolibarrInvoice, DolibarrInvoicePayment } from "../../types/dolibarr.js";
import { isPaidInvoice, isoDateFromTimestamp, unixTimestampFromIsoDate } from "../../tools/shared/normalization.js";

type InvoiceType = "client" | "supplier";

export type InvoicePaymentChoice =
  | {
      mode: "create";
      date?: string;
      paymentModeId: number;
      accountId: number;
      number?: string;
      comment?: string;
      chequeIssuer?: string;
      chequeBank?: string;
    }
  | {
      mode: "existing";
      reference: string;
    };

export interface MarkInvoicePaidInput {
  invoiceType: InvoiceType;
  invoiceId: number;
  payment?: InvoicePaymentChoice;
  closeCode?: string;
  closeNote?: string;
}

interface InvoiceAdapter {
  get: (id: number) => Promise<DolibarrInvoice>;
  getPayments: (id: number) => Promise<DolibarrInvoicePayment[]>;
  setPaid: (
    id: number,
    options?: { closeCode?: string; closeNote?: string },
  ) => Promise<DolibarrInvoice>;
  createPayment: (
    id: number,
    payment: Extract<InvoicePaymentChoice, { mode: "create" }>,
    datepaye: number,
  ) => Promise<number>;
}

function adapterFor(invoiceType: InvoiceType): InvoiceAdapter {
  if (invoiceType === "client") {
    return {
      get: getInvoice,
      getPayments: getInvoicePayments,
      setPaid: setInvoicePaid,
      createPayment: (id, payment, datepaye) =>
        createInvoicePayment(id, {
          datepaye,
          paymentid: payment.paymentModeId,
          accountid: payment.accountId,
          num_payment: payment.number,
          comment: payment.comment,
          chqemetteur: payment.chequeIssuer,
          chqbank: payment.chequeBank,
        }),
    };
  }

  return {
    get: getSupplierInvoice,
    getPayments: getSupplierInvoicePayments,
    setPaid: setSupplierInvoicePaid,
    createPayment: (id, payment, datepaye) =>
      createSupplierInvoicePayment(id, {
        datepaye,
        payment_mode_id: payment.paymentModeId,
        accountid: payment.accountId,
        num_payment: payment.number,
        comment: payment.comment,
        chqemetteur: payment.chequeIssuer,
        chqbank: payment.chequeBank,
      }),
  };
}

function isAlreadyPaidError(err: unknown, invoiceType: InvoiceType, invoiceId: number): boolean {
  const resource = invoiceType === "client" ? "invoices" : "supplierinvoices";
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/${resource}/${invoiceId}/settopaid`
  );
}

function paymentMatches(payment: DolibarrInvoicePayment, reference: string): boolean {
  const wanted = reference.trim().toLowerCase();
  return [payment.ref, payment.ref_ext, payment.num].some(
    (candidate) => candidate?.trim().toLowerCase() === wanted,
  );
}

async function ensurePaid(
  adapter: InvoiceAdapter,
  input: MarkInvoicePaidInput,
): Promise<DolibarrInvoice> {
  try {
    await adapter.setPaid(input.invoiceId, {
      closeCode: input.closeCode,
      closeNote: input.closeNote,
    });
  } catch (err) {
    if (!isAlreadyPaidError(err, input.invoiceType, input.invoiceId)) throw err;
  }
  return adapter.get(input.invoiceId);
}

export async function markInvoicePaid(input: MarkInvoicePaidInput): Promise<Record<string, unknown>> {
  const adapter = adapterFor(input.invoiceType);
  const invoice = await adapter.get(input.invoiceId);
  const idKey = input.invoiceType === "client" ? "invoice_id" : "supplier_invoice_id";

  if (isPaidInvoice(invoice)) {
    return {
      success: true,
      invoice_type: input.invoiceType,
      [idKey]: input.invoiceId,
      ref: invoice.ref,
      status: "paid",
      payment: { action: "none" },
      note: "Already paid; no payment was created.",
    };
  }

  if (Number(invoice.statut) !== 1) {
    return {
      error: "VALIDATION_ERROR",
      message: `${input.invoiceType === "client" ? "Client" : "Supplier"} invoice ${invoice.ref} must be validated before it can be marked as paid.`,
      action: input.invoiceType === "client"
        ? "Validate the invoice first with validate_invoice or set_invoice_status."
        : "Validate the supplier invoice first with set_supplier_invoice_status.",
    };
  }

  let paymentResult: Record<string, unknown> = { action: "none" };

  if (input.payment?.mode === "existing") {
    const existingPayment = input.payment;
    const payments = await adapter.getPayments(input.invoiceId);
    const linked = payments.find((payment) => paymentMatches(payment, existingPayment.reference));
    if (!linked) {
      return {
        error: "PAYMENT_NOT_LINKED",
        message: `Payment '${existingPayment.reference}' is not linked to invoice ${invoice.ref}.`,
        action: "Link the payment in Dolibarr first, or use payment.mode='create'. This Dolibarr REST API cannot add an invoice allocation to an existing payment.",
      };
    }
    paymentResult = {
      action: "existing_link_verified",
      reference: linked.ref,
      amount: Number(linked.amount),
    };
  }

  if (input.payment?.mode === "create") {
    const date = input.payment.date ?? isoDateFromTimestamp(Date.now());
    if (!date) throw new Error("Could not determine the payment date.");
    const paymentId = await adapter.createPayment(
      input.invoiceId,
      input.payment,
      unixTimestampFromIsoDate(date),
    );
    paymentResult = { action: "created", id: Number(paymentId), date };

    // closepaidinvoices=yes normally closes the invoice in the same Dolibarr
    // transaction. Only call settopaid when an installation leaves it open.
    const afterPayment = await adapter.get(input.invoiceId);
    if (isPaidInvoice(afterPayment)) {
      return {
        success: true,
        invoice_type: input.invoiceType,
        [idKey]: input.invoiceId,
        ref: afterPayment.ref,
        status: "paid",
        payment: paymentResult,
      };
    }
  }

  const paidInvoice = await ensurePaid(adapter, input);
  if (!isPaidInvoice(paidInvoice)) {
    throw new Error(`Dolibarr did not report invoice ${paidInvoice.ref} as paid after closing it.`);
  }
  return {
    success: true,
    invoice_type: input.invoiceType,
    [idKey]: input.invoiceId,
    ref: paidInvoice.ref,
    status: "paid",
    payment: paymentResult,
  };
}
