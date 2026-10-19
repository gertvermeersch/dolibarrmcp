import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listContracts } from "../../dolibarr/contracts.js";
import { listInterventions } from "../../dolibarr/interventions.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { listOrders } from "../../dolibarr/orders.js";
import { listProposals } from "../../dolibarr/proposals.js";
import { listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import { searchThirdparties } from "../../dolibarr/thirdparties.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel, orderStatusLabel, proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import {
  serializeContractSearchSummary,
  serializeInterventionSearchSummary,
} from "../shared/maintenanceSerializers.js";
import { numberOrUndefined } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import {
  serializeClientDocumentSummary,
  serializeInvoiceSearchSummary,
  serializeProposalSearchSummary,
  serializeSupplierInvoiceSearchSummary,
  serializeThirdpartySummary,
} from "../shared/serializers.js";
import { optionalSearch, resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";

const resultLimit = "10";

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
  registerJsonTool(
    server,
    "search_across",
    {
      description: "Fuzzy search across thirdparties, client invoices, supplier invoices, orders, proposals, contracts, and interventions simultaneously.",
      pretty: true,
      inputSchema: { query: z.string().describe("Search term") },
    },
    async ({ query }) => {
      const thirdparties = await searchThirdparties(query);
      const thirdpartyIds = [...new Set(thirdparties
        .map((thirdparty) => Number(thirdparty.id))
        .filter(Number.isFinite))];
      const searchParams = documentSearchParams(query, thirdpartyIds);

      const [invoices, supplierInvoices, orders, proposals, contracts, interventions] = await Promise.all([
        optionalSearch(() => listInvoices(searchParams)),
        optionalSearch(() => listSupplierInvoices(searchParams)),
        optionalSearch(() => listOrders(searchParams, { suppressErrorStatuses: [403, 404] })),
        optionalSearch(() => listProposals(searchParams)),
        optionalSearch(() => listContracts(searchParams)),
        optionalSearch(() => listInterventions(searchParams)),
      ]);
      const clientIds = [
        ...invoices,
        ...orders,
        ...proposals,
        ...contracts,
        ...interventions,
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

      return {
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
        contracts: contracts.map((contract) => serializeContractSearchSummary(contract, clientNames)),
        interventions: interventions.map((intervention) => serializeInterventionSearchSummary(intervention, clientNames)),
      };
    },
  );
}
