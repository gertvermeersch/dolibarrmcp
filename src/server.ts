import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Read-only tools expose reporting and lookup operations without mutating Dolibarr.
import { registerGetClientOverview } from "./tools/read/getClientOverview.js";
import { registerGetOutstandingReceivables } from "./tools/read/getOutstandingReceivables.js";
import { registerGetInvoiceDetail } from "./tools/read/getInvoiceDetail.js";
import { registerGetMonthlyRevenue } from "./tools/read/getMonthlyRevenue.js";
import { registerSearchAcross } from "./tools/read/searchAcross.js";
import { registerSearchProducts } from "./tools/read/searchProducts.js";
import { registerSearchServices } from "./tools/read/searchServices.js";

// Write tools create or update Dolibarr business records, so keep this import
// group easy to audit when adding capabilities.
import { registerCreateThirdparty } from "./tools/write/createThirdparty.js";
import { registerUpdateThirdparty } from "./tools/write/updateThirdparty.js";
import { registerCreateInvoice } from "./tools/write/createInvoice.js";
import { registerCreateSupplierInvoice } from "./tools/write/createSupplierInvoice.js";
import { registerCreateProposal } from "./tools/write/createProposal.js";
import { registerSetProposalStatus } from "./tools/write/setProposalStatus.js";

// Register every MCP tool on a server instance. index.ts creates one MCP server
// per transport session, then calls this function to attach the shared tool set.
export function registerTools(server: McpServer): void {
  registerGetClientOverview(server);
  registerGetOutstandingReceivables(server);
  registerGetInvoiceDetail(server);
  registerGetMonthlyRevenue(server);
  registerSearchAcross(server);
  registerSearchProducts(server);
  registerSearchServices(server);

  registerCreateThirdparty(server);
  registerUpdateThirdparty(server);
  registerCreateInvoice(server);
  registerCreateSupplierInvoice(server);
  registerCreateProposal(server);
  registerSetProposalStatus(server);
}
