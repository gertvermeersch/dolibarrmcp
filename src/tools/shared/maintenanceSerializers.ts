import {
  contractLineStatusLabel,
  contractStatusLabel,
  interventionStatusLabel,
  invoiceStatusLabel,
} from "../../dolibarr/statusLabels.js";
import {
  annualValueExclTax,
  contractEndDate,
  contractLineLabel,
  interventionDate,
  interventionDurationHours,
  isExpiredLine,
  isRenewalInvoice,
  LINE_STATUS_CLOSED,
  lineEndDate,
  lineStartDate,
  lineStatus,
} from "../../dolibarr/maintenance/contractRules.js";
import {
  cleanString,
  compactObject,
  dolibarrId,
  isoDateFromTimestamp,
  isPaidInvoice,
  money,
  numberOrUndefined,
  remainingToPay,
} from "./normalization.js";
import type {
  DolibarrContract,
  DolibarrContractLine,
  DolibarrIntervention,
  DolibarrInvoice,
} from "../../types/dolibarr.js";

export const interventionsUnavailableWarning =
  "The Dolibarr Interventions API is not accessible (module inactive or the API user lacks rights), so intervention data is missing.";

// The services a contract still covers: every line that is not closed.
export function serializeContractServices(lines: DolibarrContractLine[] = []): Record<string, unknown>[] {
  return lines
    .filter((line) => lineStatus(line) !== LINE_STATUS_CLOSED)
    .map((line) => compactObject({
      product_ref: cleanString(line.product_ref),
      label: contractLineLabel(line),
      qty: numberOrUndefined(line.qty),
    }));
}

export function serializeContractLine(line: DolibarrContractLine, today: string): Record<string, unknown> {
  return compactObject({
    line_id: dolibarrId(line.id),
    product_ref: cleanString(line.product_ref),
    label: contractLineLabel(line),
    qty: numberOrUndefined(line.qty),
    unit_price: money(line.subprice),
    vat_rate: numberOrUndefined(line.tva_tx),
    total_excluding_tax: money(line.total_ht),
    status: contractLineStatusLabel(line.statut ?? line.status),
    expired: isExpiredLine(line, today),
    start_date: lineStartDate(line),
    end_date: lineEndDate(line),
    activated_on: isoDateFromTimestamp(line.date_start_real),
    closed_on: isoDateFromTimestamp(line.date_end_real),
  });
}

export function serializeLinkedInvoice(
  invoice: DolibarrInvoice,
  contractStart: string | undefined,
): Record<string, unknown> {
  const paid = isPaidInvoice(invoice);

  return compactObject({
    id: dolibarrId(invoice.id),
    ref: cleanString(invoice.ref),
    date: isoDateFromTimestamp(invoice.date),
    status: invoiceStatusLabel(invoice.statut),
    paid,
    total_excluding_tax: money(invoice.total_ht),
    total_including_tax: money(invoice.total_ttc),
    remaining_to_pay: remainingToPay(invoice),
    is_renewal: isRenewalInvoice(contractStart, invoice),
  });
}

export function serializeIntervention(
  intervention: DolibarrIntervention,
  context: { clientNames?: Map<number, string>; contractRefs?: Map<number, string> } = {},
): Record<string, unknown> {
  const contractId = numberOrUndefined(intervention.fk_contrat);

  return compactObject({
    id: dolibarrId(intervention.id),
    ref: cleanString(intervention.ref),
    client: context.clientNames?.get(dolibarrId(intervention.socid)),
    contract: contractId !== undefined && contractId > 0 ? context.contractRefs?.get(contractId) : undefined,
    contract_id: contractId !== undefined && contractId > 0 ? contractId : undefined,
    date: interventionDate(intervention),
    duration_hours: interventionDurationHours(intervention),
    status: interventionStatusLabel(intervention.statut ?? intervention.status),
    description: cleanString(intervention.description),
  });
}

export function serializeContractSearchSummary(
  contract: DolibarrContract,
  clientNames: Map<number, string>,
): Record<string, unknown> {
  return compactObject({
    id: dolibarrId(contract.id),
    ref: cleanString(contract.ref),
    client_name: clientNames.get(dolibarrId(contract.socid)),
    status: contractStatusLabel(contract.statut ?? contract.status),
    date: isoDateFromTimestamp(contract.date_contrat),
    end_date: contractEndDate(contract.lines),
    annual_value_excluding_tax: annualValueExclTax(contract.lines),
  });
}

export function serializeInterventionSearchSummary(
  intervention: DolibarrIntervention,
  clientNames: Map<number, string>,
): Record<string, unknown> {
  return compactObject({
    id: dolibarrId(intervention.id),
    ref: cleanString(intervention.ref),
    client_name: clientNames.get(dolibarrId(intervention.socid)),
    status: interventionStatusLabel(intervention.statut ?? intervention.status),
    date: interventionDate(intervention),
    description: cleanString(intervention.description),
  });
}
