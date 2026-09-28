import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { markInvoicePaid } from "../../dolibarr/documents/invoicePaymentService.js";
import { isIsoDateString } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";

const paymentOptionSelectorSchema = z.union([
  z.number().int().positive(),
  z.string().trim().min(1),
]);

const createPaymentSchema = z.object({
  mode: z.literal("create"),
  date: z.string().refine(isIsoDateString, "Expected an ISO date (YYYY-MM-DD).").optional()
    .describe("Payment date; defaults to today in the Dolibarr timezone"),
  payment_mode: paymentOptionSelectorSchema.optional()
    .describe("Payment mode ID, exact code, or unique label; use list_payment_modes to inspect choices"),
  bank_account: paymentOptionSelectorSchema.optional()
    .describe("Bank account ID, exact ref, or unique label/bank name; use list_bank_accounts to inspect choices"),
  payment_mode_id: z.number().int().positive().optional()
    .describe("Legacy numeric payment mode ID; prefer payment_mode"),
  account_id: z.number().int().positive().optional()
    .describe("Legacy numeric bank account ID; prefer bank_account"),
  number: z.string().optional().describe("Cheque, transfer, or external payment number"),
  comment: z.string().optional().describe("Private payment note"),
  cheque_issuer: z.string().optional().describe("Required by Dolibarr for cheque payments"),
  cheque_bank: z.string().optional().describe("Issuer bank for cheque payments"),
}).refine((payment) => payment.payment_mode !== undefined || payment.payment_mode_id !== undefined, {
  message: "payment_mode is required when creating a payment.",
}).refine((payment) => payment.bank_account !== undefined || payment.account_id !== undefined, {
  message: "bank_account is required when creating a payment.",
}).refine((payment) => !(payment.payment_mode !== undefined && payment.payment_mode_id !== undefined), {
  message: "Pass payment_mode or payment_mode_id, not both.",
}).refine((payment) => !(payment.bank_account !== undefined && payment.account_id !== undefined), {
  message: "Pass bank_account or account_id, not both.",
});

const existingPaymentSchema = z.object({
  mode: z.literal("existing"),
  reference: z.string().min(1).describe("Reference or number of a payment already linked to the invoice"),
});

export function registerMarkInvoicePaid(server: McpServer): void {
  registerJsonTool(
    server,
    "mark_invoice_paid",
    {
      description: "Mark a validated client or supplier invoice as paid. Optionally create a payment for the remaining balance, or verify an already-linked payment before closing. Dolibarr REST cannot newly allocate an existing payment.",
      inputSchema: {
        invoice_type: z.enum(["client", "supplier"]),
        invoice_id: z.number().int().positive().describe("Dolibarr client or supplier invoice ID"),
        payment: z.union([createPaymentSchema, existingPaymentSchema]).optional(),
        close_code: z.string().optional().describe("Dolibarr close code for a write-off or discount when no full payment exists"),
        close_note: z.string().optional().describe("Reason for closing without a complete payment"),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    ({ invoice_type, invoice_id, payment, close_code, close_note }) =>
      markInvoicePaid({
        invoiceType: invoice_type,
        invoiceId: invoice_id,
        payment: payment?.mode === "create"
          ? {
              mode: "create",
              date: payment.date,
              paymentMode: payment.payment_mode ?? payment.payment_mode_id!,
              bankAccount: payment.bank_account ?? payment.account_id!,
              number: payment.number,
              comment: payment.comment,
              chequeIssuer: payment.cheque_issuer,
              chequeBank: payment.cheque_bank,
            }
          : payment,
        closeCode: close_code,
        closeNote: close_note,
      }),
  );
}
