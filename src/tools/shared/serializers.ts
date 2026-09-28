import {
  cleanString,
  compactObject,
  dolibarrId,
  isoDateFromTimestamp,
  money,
  numberOrUndefined,
} from "./normalization.js";
import {
  getThirdpartyClientFlag,
  getThirdpartySupplierFlag,
  getThirdpartyType,
} from "../../dolibarr/thirdpartyType.js";
import type {
  DolibarrInvoice,
  DolibarrInvoiceLine,
  DolibarrOrder,
  DolibarrProduct,
  DolibarrProposal,
  DolibarrThirdparty,
} from "../../types/dolibarr.js";

type SupplierInvoiceSearchFields = {
  ref_supplier?: unknown;
  refSupplier?: unknown;
  supplier_ref?: unknown;
};

type SupplierInvoiceLineFields = {
  description?: unknown;
  pu_ht?: unknown;
  vat_rate?: unknown;
};

export function thirdpartyNameMap(thirdparties: DolibarrThirdparty[]): Map<number, string> {
  return new Map(
    thirdparties
      .map((thirdparty): [number, string] | undefined => {
        const id = numberOrUndefined(thirdparty.id);
        const name = cleanString(thirdparty.name);
        return id !== undefined && name ? [id, name] : undefined;
      })
      .filter((entry): entry is [number, string] => entry !== undefined),
  );
}

export function serializeThirdpartySummary(thirdparty: DolibarrThirdparty): Record<string, unknown> {
  return compactObject({
    id: dolibarrId(thirdparty.id),
    name: cleanString(thirdparty.name),
    type: getThirdpartyType(thirdparty),
    is_client: getThirdpartyClientFlag(thirdparty) > 0,
    is_supplier: getThirdpartySupplierFlag(thirdparty) > 0,
    email: cleanString(thirdparty.email),
    phone: cleanString(thirdparty.phone),
    town: cleanString(thirdparty.town),
    zip: cleanString(thirdparty.zip),
  });
}

export function serializeThirdpartyIdentity(thirdparty: DolibarrThirdparty): Record<string, unknown> {
  return compactObject({
    id: dolibarrId(thirdparty.id),
    name: cleanString(thirdparty.name),
    email: cleanString(thirdparty.email),
    phone: cleanString(thirdparty.phone),
    address: cleanString(thirdparty.address),
    zip: cleanString(thirdparty.zip),
    town: cleanString(thirdparty.town),
    vat_number: cleanString(thirdparty.tva_intra),
  });
}

export function serializeLineItem(line: DolibarrInvoiceLine): Record<string, unknown> {
  const supplierLine = line as DolibarrInvoiceLine & SupplierInvoiceLineFields;
  const label = cleanString(line.product_label) ?? cleanString(line.desc) ?? cleanString(supplierLine.description);

  return compactObject({
    line_id: dolibarrId(line.id),
    product_ref: cleanString(line.product_ref),
    label,
    description: cleanString(line.desc) ?? cleanString(supplierLine.description),
    qty: numberOrUndefined(line.qty),
    unit_price: money(line.subprice ?? supplierLine.pu_ht),
    discount_percent: numberOrUndefined(line.remise_percent),
    vat_rate: numberOrUndefined(line.tva_tx ?? supplierLine.vat_rate),
    total_excluding_tax: money(line.total_ht),
    total_including_tax: money(line.total_ttc),
  });
}

export function serializeCatalogItem(item: DolibarrProduct): Record<string, unknown> {
  const type = numberOrUndefined(item.type);

  return compactObject({
    id: dolibarrId(item.id),
    ref: cleanString(item.ref),
    label: cleanString(item.label),
    price: money(item.price),
    vat_rate: numberOrUndefined(item.tva_tx),
    type: type === 1 ? "service" : "product",
  });
}

export function serializeCatalogItemDetail(item: DolibarrProduct): Record<string, unknown> {
  return compactObject({
    ...serializeCatalogItem(item),
    description: cleanString(item.description),
    price_including_tax: money(item.price_ttc),
    on_sale: numberOrUndefined(item.status) === 1,
    on_purchase: numberOrUndefined(item.status_buy) === 1,
    note_public: cleanString(item.note_public),
    note_private: cleanString(item.note_private),
  });
}

export function serializeClientDocumentSummary(
  document: DolibarrInvoice | DolibarrProposal | DolibarrOrder,
  status: string,
  clientNames: Map<number, string>,
): Record<string, unknown> {
  return compactObject({
    id: dolibarrId(document.id),
    ref: cleanString(document.ref),
    client_name: clientNames.get(dolibarrId(document.socid)),
    status,
    date: isoDateFromTimestamp(
      (document as DolibarrOrder).date_commande ?? document.date,
    ),
    total_excluding_tax: money(document.total_ht),
    total_including_tax: money(document.total_ttc),
  });
}

export function serializeProposalSearchSummary(
  proposal: DolibarrProposal,
  status: string,
  clientNames: Map<number, string>,
): Record<string, unknown> {
  return compactObject({
    ...serializeClientDocumentSummary(proposal, status, clientNames),
    valid_until: isoDateFromTimestamp(proposal.fin_validite),
  });
}

export function serializeInvoiceSearchSummary(
  invoice: DolibarrInvoice,
  status: string,
  clientNames: Map<number, string>,
): Record<string, unknown> {
  return compactObject({
    ...serializeClientDocumentSummary(invoice, status, clientNames),
    due_date: isoDateFromTimestamp(invoice.date_lim_reglement),
  });
}

export function serializeSupplierInvoiceSearchSummary(
  invoice: DolibarrInvoice,
  status: string,
  supplierNames: Map<number, string>,
): Record<string, unknown> {
  const supplierInvoice = invoice as DolibarrInvoice & SupplierInvoiceSearchFields;
  return compactObject({
    id: dolibarrId(invoice.id),
    ref: cleanString(invoice.ref),
    supplier_ref: cleanString(
      supplierInvoice.ref_supplier ?? supplierInvoice.refSupplier ?? supplierInvoice.supplier_ref,
    ),
    supplier_name: supplierNames.get(dolibarrId(invoice.socid)),
    status,
    date: isoDateFromTimestamp(invoice.date),
    due_date: isoDateFromTimestamp(invoice.date_lim_reglement),
    total_excluding_tax: money(invoice.total_ht),
    total_including_tax: money(invoice.total_ttc),
  });
}
