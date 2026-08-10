import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerSearchProducts } from "./tools/catalog/searchProducts.js";
import { registerSearchServices } from "./tools/catalog/searchServices.js";
import { registerCreateInvoice } from "./tools/invoices/createInvoice.js";
import { registerCreateSupplierInvoice } from "./tools/invoices/createSupplierInvoice.js";
import { registerDeleteInvoice } from "./tools/invoices/deleteInvoice.js";
import { registerDeleteSupplierInvoice } from "./tools/invoices/deleteSupplierInvoice.js";
import { registerGetInvoiceDetail } from "./tools/invoices/getInvoiceDetail.js";
import { registerGetMonthlyRevenue } from "./tools/invoices/getMonthlyRevenue.js";
import { registerGetOutstandingReceivables } from "./tools/invoices/getOutstandingReceivables.js";
import { registerGetSupplierInvoiceDetail } from "./tools/invoices/getSupplierInvoiceDetail.js";
import { registerMarkInvoicePaid } from "./tools/invoices/markInvoicePaid.js";
import { registerSetInvoiceStatus } from "./tools/invoices/setInvoiceStatus.js";
import { registerSetSupplierInvoiceStatus } from "./tools/invoices/setSupplierInvoiceStatus.js";
import { registerValidateInvoice } from "./tools/invoices/validateInvoice.js";
import { registerCreateProposal } from "./tools/proposals/createProposal.js";
import { registerDeleteProposal } from "./tools/proposals/deleteProposal.js";
import { registerGetProposalDetail } from "./tools/proposals/getProposalDetail.js";
import { registerSetProposalStatus } from "./tools/proposals/setProposalStatus.js";
import { registerValidateProposal } from "./tools/proposals/validateProposal.js";
import { registerSearchAcross } from "./tools/search/searchAcross.js";
import { registerSearchDocumentContent } from "./tools/search/searchDocumentContent.js";
import { registerCreateThirdparty } from "./tools/thirdparties/createThirdparty.js";
import { registerDeleteThirdparty } from "./tools/thirdparties/deleteThirdparty.js";
import { registerGetClientOverview } from "./tools/thirdparties/getClientOverview.js";
import { registerSearchThirdparties } from "./tools/thirdparties/searchThirdparties.js";
import { registerUpdateThirdparty } from "./tools/thirdparties/updateThirdparty.js";

// Register every MCP tool on a server instance. index.ts creates one MCP server
// per transport session, then calls this function to attach the shared tool set.
export function registerTools(server: McpServer): void {
  registerSearchProducts(server);
  registerSearchServices(server);

  registerCreateInvoice(server);
  registerCreateSupplierInvoice(server);
  registerValidateInvoice(server);
  registerSetInvoiceStatus(server);
  registerSetSupplierInvoiceStatus(server);
  registerMarkInvoicePaid(server);
  registerDeleteInvoice(server);
  registerDeleteSupplierInvoice(server);
  registerGetInvoiceDetail(server);
  registerGetSupplierInvoiceDetail(server);
  registerGetMonthlyRevenue(server);
  registerGetOutstandingReceivables(server);

  registerCreateProposal(server);
  registerGetProposalDetail(server);
  registerValidateProposal(server);
  registerSetProposalStatus(server);
  registerDeleteProposal(server);

  registerSearchAcross(server);
  registerSearchDocumentContent(server);

  registerSearchThirdparties(server);
  registerCreateThirdparty(server);
  registerGetClientOverview(server);
  registerUpdateThirdparty(server);
  registerDeleteThirdparty(server);
}
