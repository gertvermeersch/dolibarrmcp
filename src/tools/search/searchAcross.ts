import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { listOrders } from "../../dolibarr/orders.js";
import { listProposals } from "../../dolibarr/proposals.js";
import { listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import {
  getThirdparty,
  searchThirdparties,
} from "../../dolibarr/thirdparties.js";
import { DolibarrApiError, toApiError } from "../../dolibarr/client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel, orderStatusLabel, proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { dolibarrId, numberOrUndefined } from "../shared/normalization.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";
import {
  serializeClientDocumentSummary,
  serializeInvoiceSearchSummary,
  serializeProposalSearchSummary,
  serializeSupplierInvoiceSearchSummary,
  serializeThirdpartySummary,
  thirdpartyNameMap,
} from "../shared/serializers.js";
import type { DolibarrThirdparty } from "../../types/dolibarr.js";

const resultLimit = "10";

async function optionalSearch<T>(search: () => Promise<T[]>): Promise<T[]> {
  try {
    return await search();
  } catch (err) {
    if (err instanceof DolibarrApiError && (err.status === 403 || err.status === 404)) return [];
    throw err;
  }
}

async function resolveMissingThirdpartyNames(
  ids: number[],
  knownThirdparties: DolibarrThirdparty[],
): Promise<Map<number, string>> {
  const names = thirdpartyNameMap(knownThirdparties);
  const missingIds = [...new Set(ids)].filter((id) => !names.has(id));

  const missingThirdparties = await Promise.all(
    missingIds.map((id) => optionalSearch(() => getThirdparty(id).then((thirdparty) => [thirdparty]))),
  );

  for (const thirdparty of missingThirdparties.flat()) {
    names.set(dolibarrId(thirdparty.id), thirdparty.name);
  }

  return names;
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
        const clientIds = [
          ...invoices,
          ...orders,
          ...proposals,
        ]
          .map((document) => numberOrUndefined(document.socid))
          .filter((id): id is number => id !== undefined);
        const supplierIds = supplierInvoices
          .map((document) => numberOrUndefined(document.socid))
          .filter((id): id is number => id !== undefined);
        const [clientNames, supplierNames] = await Promise.all([
          resolveMissingThirdpartyNames(clientIds, thirdparties),
          resolveMissingThirdpartyNames(supplierIds, thirdparties),
        ]);

        return prettyJsonContent({
          thirdparties: thirdparties.map(serializeThirdpartySummary),
          invoices: invoices.map((invoice) => serializeInvoiceSearchSummary(
            invoice,
            invoiceStatusLabel(invoice.statut) ?? "unknown",
            clientNames,
          )),
          supplier_invoices: supplierInvoices.map((invoice) => serializeSupplierInvoiceSearchSummary(
            invoice,
            invoiceStatusLabel(invoice.statut) ?? "unknown",
            supplierNames,
          )),
          orders: orders.map((order) => serializeClientDocumentSummary(
            order,
            orderStatusLabel(order.statut ?? order.status) ?? "unknown",
            clientNames,
          )),
          proposals: proposals.map((proposal) => serializeProposalSearchSummary(
            proposal,
            proposalStatusLabel(proposal.statut) ?? "unknown",
            clientNames,
          )),
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
