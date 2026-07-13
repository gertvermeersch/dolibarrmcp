import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInvoice, listInvoices } from "../../dolibarr/invoices.js";
import { getOrder, listOrders } from "../../dolibarr/orders.js";
import { getProposal, listProposals } from "../../dolibarr/proposals.js";
import { getSupplierInvoice, listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import {
  documentContentTypes,
  searchDocumentContent,
  type DocumentContentType,
} from "./documentContentSearch.js";

function recentDocumentParams(limit: number): string {
  return dolibarrQueryString({
    sortfield: "t.rowid",
    sortorder: "DESC",
    limit: String(limit),
  });
}

export function registerSearchDocumentContent(server: McpServer): void {
  registerJsonTool(
    server,
    "search_document_content",
    {
      description: "Search line descriptions in recent proposals, customer orders, client invoices, and supplier invoices. Uses a bounded fetch because Dolibarr document-list filters do not search line tables.",
      pretty: true,
      inputSchema: {
        query: z.string().trim().min(1).describe("Text contained in a document line description"),
        document_types: z.array(z.enum(documentContentTypes))
          .min(1)
          .optional()
          .describe("Document types to scan; defaults to all four types"),
        max_documents_per_type: z.number().int().min(1).max(100)
          .optional()
          .describe("Maximum recent documents fetched per type; defaults to 25"),
        limit: z.number().int().min(1).max(100)
          .optional()
          .describe("Maximum matching lines returned; defaults to 50"),
      },
    },
    async ({ query, document_types, max_documents_per_type, limit }) => searchDocumentContent(
      {
        query,
        documentTypes: document_types as DocumentContentType[] | undefined,
        maxDocumentsPerType: max_documents_per_type,
        limit,
      },
      {
        domains: {
          proposal: {
            list: (count) => listProposals(recentDocumentParams(count)),
            get: getProposal,
          },
          order: {
            list: (count) => listOrders(
              recentDocumentParams(count),
              { suppressErrorStatuses: [403, 404] },
            ),
            get: getOrder,
          },
          client_invoice: {
            list: (count) => listInvoices(recentDocumentParams(count)),
            get: getInvoice,
          },
          supplier_invoice: {
            list: (count) => listSupplierInvoices(recentDocumentParams(count)),
            get: getSupplierInvoice,
          },
        },
        getThirdparty,
      },
    ),
  );
}
