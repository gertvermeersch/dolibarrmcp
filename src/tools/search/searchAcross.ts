import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { listOrders } from "../../dolibarr/orders.js";
import { listProposals } from "../../dolibarr/proposals.js";
import {
  getThirdpartyClientFlag,
  getThirdpartySupplierFlag,
  getThirdpartyType,
  searchThirdparties,
} from "../../dolibarr/thirdparties.js";
import { DolibarrApiError, toApiError } from "../../dolibarr/client.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";

const resultLimit = "10";

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
      description: "Fuzzy search across thirdparties, invoices, orders, and proposals simultaneously.",
      inputSchema: { query: z.string().describe("Search term") },
    },
    async ({ query }) => {
      try {
        const thirdparties = await searchThirdparties(query);
        const thirdpartyIds = [...new Set(thirdparties
          .map((thirdparty) => Number(thirdparty.id))
          .filter(Number.isFinite))];
        const searchParams = documentSearchParams(query, thirdpartyIds);

        const [invoices, orders, proposals] = await Promise.all([
          optionalSearch(() => listInvoices(searchParams)),
          optionalSearch(() => listOrders(searchParams)),
          optionalSearch(() => listProposals(searchParams)),
        ]);

        return prettyJsonContent({
          thirdparties: thirdparties.map((thirdparty) => ({
            id: thirdparty.id,
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
            id: invoice.id,
            ref: invoice.ref,
            client_id: invoice.socid,
            status: invoice.statut,
            date: invoice.date,
            due_date: invoice.date_lim_reglement,
            total_ht: invoice.total_ht,
            total_ttc: invoice.total_ttc,
          })),
          orders: orders.map((order) => ({
            id: order.id,
            ref: order.ref,
            client_id: order.socid,
            status: order.statut ?? order.status,
            date: order.date_commande ?? order.date,
            total_ht: order.total_ht,
            total_ttc: order.total_ttc,
          })),
          proposals: proposals.map((proposal) => ({
            id: proposal.id,
            ref: proposal.ref,
            client_id: proposal.socid,
            status: proposal.statut,
            date: proposal.date,
            valid_until: proposal.date_fin_validite,
            total_ht: proposal.total_ht,
            total_ttc: proposal.total_ttc,
          })),
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
