import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Read tools
import { registerGetClientOverview } from "./tools/read/getClientOverview.js";
import { registerGetOutstandingReceivables } from "./tools/read/getOutstandingReceivables.js";
import { registerGetInvoiceDetail } from "./tools/read/getInvoiceDetail.js";
import { registerGetMonthlyRevenue } from "./tools/read/getMonthlyRevenue.js";
import { registerSearchAcross } from "./tools/read/searchAcross.js";
import { registerSearchProducts } from "./tools/read/searchProducts.js";

// Write tools
import { registerCreateThirdparty } from "./tools/write/createThirdparty.js";
import { registerUpdateThirdparty } from "./tools/write/updateThirdparty.js";
import { registerCreateInvoice } from "./tools/write/createInvoice.js";
import { registerCreateSupplierInvoice } from "./tools/write/createSupplierInvoice.js";
import { registerCreateProposal } from "./tools/write/createProposal.js";
import { registerSetProposalStatus } from "./tools/write/setProposalStatus.js";

export function registerTools(server: McpServer): void {
  registerGetClientOverview(server);
  registerGetOutstandingReceivables(server);
  registerGetInvoiceDetail(server);
  registerGetMonthlyRevenue(server);
  registerSearchAcross(server);
  registerSearchProducts(server);

  registerCreateThirdparty(server);
  registerUpdateThirdparty(server);
  registerCreateInvoice(server);
  registerCreateSupplierInvoice(server);
  registerCreateProposal(server);
  registerSetProposalStatus(server);
}
