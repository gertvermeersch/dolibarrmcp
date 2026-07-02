import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { listOrders } from "../../dolibarr/orders.js";
import { listProposals } from "../../dolibarr/proposals.js";
import { listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import {
  getThirdpartyClientFlag,
  getThirdpartySupplierFlag,
  getThirdpartyType,
  searchThirdparties,
} from "../../dolibarr/thirdparties.js";
import { DolibarrApiError, toApiError } from "../../dolibarr/client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel, orderStatusLabel, proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { dolibarrId, isoDateFromTimestamp, money } from "../shared/normalization.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";

const resultLimit = "10";

type SupplierInvoiceSearchResult = {
  id: number;
  ref: string;
  socid: number;
  statut: number;
  date: number;
  date_lim_reglement: number;
  total_ht: number;
  total_ttc: number;
  ref_supplier?: string;
  refSupplier?: string;
  supplier_ref?: string;
};

async function optionalSearch<T>(search: () => Promise<T[]>): Promise<T[]> {
  try {
    return await search();
  } catch (err) {
    if (err instanceof DolibarrApiError && (err.status === 403 || err.status === 404)) return [];
    throw err;
  }
}

function documentSearchParams(query: string, thirdpartyIds: number[]): string {
  const search = dolibarrLikeLiteral(query);
  const filters = [
    `(t.ref:like:${search})`,
    ...thirdpartyIds.map((id) => `(t.fk_soc:=:${id})`),
  ];

  return dolibarrQueryString({
    sqlfilters: filters.join(" OR "),
    limit: resultLimit,
  });
}

export function registerSearchAcross(server: McpServer): void {
  server.registerTool(
    "search_across",
    {
      description: "Fuzzy search across thirdparties, client invoices, supplier invoices, orders, and proposals simultaneously.",
      inputSchema: { query: z.string().describe("Search term") },
    },
    async ({ query }) => {
      try {
        const thirdparties = await searchThirdparties(query);
        const thirdpartyIds = [...new Set(thirdparties
          .map((thirdparty) => Number(thirdparty.id))
          .filter(Number.isFinite))];
        const searchParams = documentSearchParams(query, thirdpartyIds);

        const [invoices, supplierInvoices, orders, proposals] = await Promise.all([
          optionalSearch(() => listInvoices(searchParams)),
          optionalSearch(() => listSupplierInvoices(searchParams)),
          optionalSearch(() => listOrders(searchParams, { suppressErrorStatuses: [403, 404] })),
          optionalSearch(() => listProposals(searchParams)),
        ]);

        return prettyJsonContent({
          thirdparties: thirdparties.map((thirdparty) => ({
            id: dolibarrId(thirdparty.id),
            name: thirdparty.name,
            type: getThirdpartyType(thirdparty),
            is_client: getThirdpartyClientFlag(thirdparty) > 0,
            is_supplier: getThirdpartySupplierFlag(thirdparty) > 0,
            email: thirdparty.email,
            phone: thirdparty.phone,
            code_client: thirdparty.code_client,
            code_supplier: thirdparty.code_fournisseur,
            town: thirdparty.town,
            zip: thirdparty.zip,
          })),
          invoices: invoices.map((invoice) => ({
            id: dolibarrId(invoice.id),
            ref: invoice.ref,
            client_id: dolibarrId(invoice.socid),
            status: invoiceStatusLabel(invoice.statut),
            status_code: invoice.statut,
            date: isoDateFromTimestamp(invoice.date),
            due_date: isoDateFromTimestamp(invoice.date_lim_reglement),
            total_excluding_tax: money(invoice.total_ht),
            total_including_tax: money(invoice.total_ttc),
          })),
          supplier_invoices: supplierInvoices.map((invoice) => {
            const supplierInvoice = invoice as SupplierInvoiceSearchResult;
            return {
              id: dolibarrId(invoice.id),
              ref: invoice.ref,
              supplier_ref: supplierInvoice.ref_supplier ?? supplierInvoice.refSupplier ?? supplierInvoice.supplier_ref,
              supplier_id: dolibarrId(invoice.socid),
              status: invoiceStatusLabel(invoice.statut),
              status_code: invoice.statut,
              date: isoDateFromTimestamp(invoice.date),
              due_date: isoDateFromTimestamp(invoice.date_lim_reglement),
              total_excluding_tax: money(invoice.total_ht),
              total_including_tax: money(invoice.total_ttc),
            };
          }),
          orders: orders.map((order) => ({
            id: dolibarrId(order.id),
            ref: order.ref,
            client_id: dolibarrId(order.socid),
            status: orderStatusLabel(order.statut ?? order.status),
            status_code: order.statut ?? order.status,
            date: isoDateFromTimestamp(order.date_commande ?? order.date),
            total_excluding_tax: money(order.total_ht),
            total_including_tax: money(order.total_ttc),
          })),
          proposals: proposals.map((proposal) => ({
            id: dolibarrId(proposal.id),
            ref: proposal.ref,
            client_id: dolibarrId(proposal.socid),
            status: proposalStatusLabel(proposal.statut),
            status_code: proposal.statut,
            date: isoDateFromTimestamp(proposal.date),
            valid_until: isoDateFromTimestamp(proposal.date_fin_validite),
            total_excluding_tax: money(proposal.total_ht),
            total_including_tax: money(proposal.total_ttc),
          })),
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
