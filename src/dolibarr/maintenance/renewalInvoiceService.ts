import {
  isIsoDateString,
  money,
  numberOrUndefined,
  numberOrZero,
  unixTimestampFromIsoDate,
} from "../../tools/shared/normalization.js";
import { getContract } from "../contracts.js";
import { addInvoiceLine, createInvoice, validateInvoice } from "../invoices.js";
import type { DolibarrContract, DolibarrInvoiceLine } from "../../types/dolibarr.js";
import type { McpError } from "../../types/tools.js";
import {
  contractStartDate,
  isRenewalInvoice,
  linkedObjectIds,
  nextRenewalPeriod,
  renewalInvoiceLines,
  runningLines,
  todayIso,
  type RenewalPeriod,
} from "./contractRules.js";
import { withLinkedInvoices } from "./contractReadService.js";

export interface RenewalInvoiceInput {
  contract: DolibarrContract;
  /** Invoice date (YYYY-MM-DD); defaults to today. */
  date?: string;
  dueDate?: string;
  /** Length of the renewal period; defaults to the length of the contract term. */
  months?: number;
  /** Create the invoice even though a renewal invoice is already linked. */
  allowDuplicate: boolean;
  validate: boolean;
}

export interface RenewalInvoiceSuccess {
  success: true;
  invoiceId: number;
  contract: { id: number; ref: string };
  period: RenewalPeriod;
  lines: Array<{ description: string; qty: number; unit_price: number; vat_rate: number }>;
  totalExcludingTax: number;
  validated: boolean;
  linkedToContract: boolean;
  existingRenewalInvoiceIds: number[];
}

export interface RenewalAlreadyInvoiced extends McpError {
  error: "RENEWAL_ALREADY_INVOICED";
  invoice_ids: number[];
}

// The invoice exists as a draft but a later step failed. Nothing is deleted.
export interface RenewalInvoicePartialFailure extends McpError {
  invoice_id: number;
  failed_step: string;
}

export type RenewalInvoiceResult =
  | RenewalInvoiceSuccess
  | RenewalAlreadyInvoiced
  | RenewalInvoicePartialFailure
  | McpError;

export interface RenewalInvoiceDeps {
  createInvoice: typeof createInvoice;
  addInvoiceLine: typeof addInvoiceLine;
  validateInvoice: typeof validateInvoice;
  getContract: typeof getContract;
  withLinkedInvoices: typeof withLinkedInvoices;
  today: () => string;
}

const defaultDeps: RenewalInvoiceDeps = {
  createInvoice,
  addInvoiceLine,
  validateInvoice,
  getContract,
  withLinkedInvoices,
  today: () => todayIso(),
};

export class RenewalInvoiceService {
  private readonly deps: RenewalInvoiceDeps;

  constructor(deps: Partial<RenewalInvoiceDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async create(input: RenewalInvoiceInput): Promise<RenewalInvoiceResult> {
    const { contract } = input;
    const date = input.date ?? this.deps.today();

    if (!isIsoDateString(date)) {
      return { error: "VALIDATION_ERROR", message: "Date must be a valid YYYY-MM-DD calendar date." };
    }
    if (input.dueDate !== undefined) {
      if (!isIsoDateString(input.dueDate)) {
        return { error: "VALIDATION_ERROR", message: "Due date must be a valid YYYY-MM-DD calendar date." };
      }
      if (input.dueDate < date) {
        return { error: "VALIDATION_ERROR", message: "Due date must be on or after the invoice date." };
      }
    }

    const lines = contract.lines ?? [];
    if (runningLines(lines).length === 0) {
      return {
        error: "VALIDATION_ERROR",
        message: `Contract ${contract.ref} has no running services to renew.`,
        action: "Only contracts with activated service lines can be renewed.",
      };
    }

    const period = nextRenewalPeriod(lines, input.months);
    if (!period) {
      return {
        error: "VALIDATION_ERROR",
        message: `Contract ${contract.ref} has no line end date, so the next period cannot be determined.`,
      };
    }

    const { invoices } = await this.deps.withLinkedInvoices(contract);
    const start = contractStartDate(contract);
    const existing = invoices.filter((invoice) => isRenewalInvoice(start, invoice));
    const existingIds = existing.map((invoice) => Number(invoice.id));

    if (existing.length > 0 && !input.allowDuplicate) {
      return {
        error: "RENEWAL_ALREADY_INVOICED",
        message: `Contract ${contract.ref} already has a linked renewal invoice (${existing.map((invoice) => invoice.ref).join(", ")}).`,
        action: "Check it with get_contract_detail. Pass allow_duplicate:true only when a second renewal invoice is really intended.",
        invoice_ids: existingIds,
      };
    }

    const socid = numberOrUndefined(contract.socid);
    if (socid === undefined) {
      return { error: "VALIDATION_ERROR", message: `Contract ${contract.ref} has no thirdparty.` };
    }

    const invoiceLines = renewalInvoiceLines(lines, period);
    const contractId = Number(contract.id);
    let invoiceId: number | undefined;
    let step = "create invoice";

    try {
      invoiceId = await this.deps.createInvoice({
        socid,
        date: unixTimestampFromIsoDate(date),
        ...(input.dueDate ? { date_lim_reglement: unixTimestampFromIsoDate(input.dueDate) } : {}),
        linked_objects: { contrat: contractId },
      });

      step = "add lines";
      for (const line of invoiceLines) {
        await this.deps.addInvoiceLine(invoiceId, line);
      }

      if (input.validate) {
        step = "validate invoice";
        await this.deps.validateInvoice(invoiceId);
      }

      step = "verify contract link";
      const linkedToContract = await this.isLinked(contractId, invoiceId);

      return {
        success: true,
        invoiceId,
        contract: { id: contractId, ref: contract.ref },
        period,
        lines: invoiceLines.map(summarizeLine),
        totalExcludingTax: lineTotal(invoiceLines),
        validated: input.validate,
        linkedToContract,
        existingRenewalInvoiceIds: existingIds,
      };
    } catch (err) {
      if (invoiceId === undefined) throw err;

      return {
        error: "DOLIBARR_API_ERROR",
        message: `Invoice ${invoiceId} was created, but the step '${step}' failed: ${err instanceof Error ? err.message : String(err)}. Nothing was deleted; inspect the invoice with get_invoice_detail.`,
        action: "Complete or remove the draft invoice in Dolibarr, then retry.",
        invoice_id: invoiceId,
        failed_step: step,
      } satisfies RenewalInvoicePartialFailure;
    }
  }

  // Dolibarr silently ignores unsupported link fields, so confirm on the contract.
  private async isLinked(contractId: number, invoiceId: number): Promise<boolean> {
    const refreshed = await this.deps.getContract(contractId);
    return linkedObjectIds(refreshed.linkedObjectsIds, "facture").includes(invoiceId);
  }
}

function summarizeLine(line: Partial<DolibarrInvoiceLine>) {
  return {
    description: line.desc ?? "",
    qty: numberOrZero(line.qty),
    unit_price: money(line.subprice) ?? 0,
    vat_rate: numberOrZero(line.tva_tx),
  };
}

function lineTotal(lines: Partial<DolibarrInvoiceLine>[]): number {
  return money(lines.reduce(
    (sum, line) => sum + numberOrZero(line.qty) * numberOrZero(line.subprice) * (1 - numberOrZero(line.remise_percent) / 100),
    0,
  )) ?? 0;
}
