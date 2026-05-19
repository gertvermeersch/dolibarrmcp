import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerSearchProducts } from "./tools/catalog/searchProducts.js";
import { registerSearchServices } from "./tools/catalog/searchServices.js";
import { registerCreateInvoice } from "./tools/invoices/createInvoice.js";
import { registerCreateSupplierInvoice } from "./tools/invoices/createSupplierInvoice.js";
import { registerGetInvoiceDetail } from "./tools/invoices/getInvoiceDetail.js";
import { registerGetMonthlyRevenue } from "./tools/invoices/getMonthlyRevenue.js";
import { registerGetOutstandingReceivables } from "./tools/invoices/getOutstandingReceivables.js";
import { registerCreateProposal } from "./tools/proposals/createProposal.js";
import { registerSetProposalStatus } from "./tools/proposals/setProposalStatus.js";
import { registerSearchAcross } from "./tools/search/searchAcross.js";
import { registerCreateThirdparty } from "./tools/thirdparties/createThirdparty.js";
import { registerGetClientOverview } from "./tools/thirdparties/getClientOverview.js";
import { registerUpdateThirdparty } from "./tools/thirdparties/updateThirdparty.js";

// Register every MCP tool on a server instance. index.ts creates one MCP server
// per transport session, then calls this function to attach the shared tool set.
export function registerTools(server: McpServer): void {
  registerSearchProducts(server);
  registerSearchServices(server);

  registerCreateInvoice(server);
  registerCreateSupplierInvoice(server);
  registerGetInvoiceDetail(server);
  registerGetMonthlyRevenue(server);
  registerGetOutstandingReceivables(server);

  registerCreateProposal(server);
  registerSetProposalStatus(server);

  registerSearchAcross(server);

  registerCreateThirdparty(server);
  registerGetClientOverview(server);
  registerUpdateThirdparty(server);
}
