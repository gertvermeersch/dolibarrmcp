import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListInvoices } from "./tools/invoices/listInvoices.js";
import { registerListProposals } from "./tools/proposals/listProposals.js";
import { registerListOrders } from "./tools/orders/listOrders.js";
import { registerListContracts } from "./tools/contracts/listContracts.js";
import { registerListPayments } from "./tools/payments/listPayments.js";
import { registerListProducts } from "./tools/catalog/listProducts.js";

import { registerSearchProducts } from "./tools/catalog/searchProducts.js";
import { registerSearchServices } from "./tools/catalog/searchServices.js";
import { registerUpdateProduct } from "./tools/catalog/updateProduct.js";
import { registerUpdateService } from "./tools/catalog/updateService.js";
import { registerCreateContract } from "./tools/contracts/createContract.js";
import { registerCreateRenewalInvoice } from "./tools/contracts/createRenewalInvoice.js";
import { registerGetContractDetail } from "./tools/contracts/getContractDetail.js";
import { registerGetMaintenanceOverview } from "./tools/contracts/getMaintenanceOverview.js";
import { registerListContractsByExpiry } from "./tools/contracts/listContractsByExpiry.js";
import { registerSetContractStatus } from "./tools/contracts/setContractStatus.js";
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
import { registerUpdateInvoice } from "./tools/invoices/updateInvoice.js";
import { registerUpdateSupplierInvoice } from "./tools/invoices/updateSupplierInvoice.js";
import { registerValidateInvoice } from "./tools/invoices/validateInvoice.js";
import { registerCreateIntervention } from "./tools/interventions/createIntervention.js";
import { registerListInterventions } from "./tools/interventions/listInterventions.js";
import { registerListBankAccounts } from "./tools/payments/listBankAccounts.js";
import { registerListPaymentModes } from "./tools/payments/listPaymentModes.js";
import { registerCreateProposal } from "./tools/proposals/createProposal.js";
import { registerDeleteProposal } from "./tools/proposals/deleteProposal.js";
import { registerGetProposalDetail } from "./tools/proposals/getProposalDetail.js";
import { registerSetProposalStatus } from "./tools/proposals/setProposalStatus.js";
import { registerUpdateProposal } from "./tools/proposals/updateProposal.js";
import { registerValidateProposal } from "./tools/proposals/validateProposal.js";
import { registerCreateProject } from "./tools/projects/createProject.js";
import { registerCreateTask } from "./tools/projects/createTask.js";
import { registerGetPipelineOverview } from "./tools/projects/getPipelineOverview.js";
import { registerGetProjectDetail } from "./tools/projects/getProjectDetail.js";
import { registerListProjects } from "./tools/projects/listProjects.js";
import { registerListTimeEntries } from "./tools/projects/listTimeEntries.js";
import { registerLogTime } from "./tools/projects/logTime.js";
import { registerSetProjectStatus } from "./tools/projects/setProjectStatus.js";
import { registerUpdateProject } from "./tools/projects/updateProject.js";
import { registerUpdateTask } from "./tools/projects/updateTask.js";
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
  registerListInvoices(server);
  registerListProposals(server);
  registerListOrders(server);
  registerListContracts(server);
  registerListPayments(server);
  registerListProducts(server);
  registerSearchProducts(server);
  registerSearchServices(server);
  registerUpdateProduct(server);
  registerUpdateService(server);

  registerCreateInvoice(server);
  registerCreateSupplierInvoice(server);
  registerUpdateInvoice(server);
  registerUpdateSupplierInvoice(server);
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

  registerListPaymentModes(server);
  registerListBankAccounts(server);

  registerCreateProposal(server);
  registerUpdateProposal(server);
  registerGetProposalDetail(server);
  registerValidateProposal(server);
  registerSetProposalStatus(server);
  registerDeleteProposal(server);

  registerListContractsByExpiry(server);
  registerGetContractDetail(server);
  registerGetMaintenanceOverview(server);
  registerCreateContract(server);
  registerCreateRenewalInvoice(server);
  registerSetContractStatus(server);

  registerListInterventions(server);
  registerCreateIntervention(server);

  registerListProjects(server);
  registerGetProjectDetail(server);
  registerGetPipelineOverview(server);
  registerListTimeEntries(server);
  registerCreateProject(server);
  registerUpdateProject(server);
  registerSetProjectStatus(server);
  registerCreateTask(server);
  registerUpdateTask(server);
  registerLogTime(server);

  registerSearchAcross(server);
  registerSearchDocumentContent(server);

  registerSearchThirdparties(server);
  registerCreateThirdparty(server);
  registerGetClientOverview(server);
  registerUpdateThirdparty(server);
  registerDeleteThirdparty(server);
}
