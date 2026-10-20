import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInvoice, listInvoices } from "../../dolibarr/invoices.js";
import { getOrder, listOrders } from "../../dolibarr/orders.js";
import { getProposal, listProposals } from "../../dolibarr/proposals.js";
import { getSupplierInvoice, listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import {
  documentContentTypes,
  searchDocumentContent,
  type DocumentContentType,
} from "./documentContentSearch.js";

function recentDocumentParams(limit: number, thirdpartyId?: number): string {
  return dolibarrQueryString({
    sortfield: "t.rowid",
    sortorder: "DESC",
    limit: String(limit),
    ...(thirdpartyId !== undefined ? { thirdparty_ids: String(thirdpartyId) } : {}),
  });
}

export function registerSearchDocumentContent(server: McpServer): void {
  registerJsonTool(
    server,
    "search_document_content",
    {
      description: "Search line descriptions in recent proposals, customer orders, client invoices, and supplier invoices. Optional thirdparty filters apply before the bounded scan, so older documents for that customer remain discoverable. A name resolves to a single thirdparty or returns candidates for clarification.",
      pretty: true,
      inputSchema: {
        query: z.string().trim().min(1).describe("Text contained in a document line description"),
        thirdparty_id: z.number().int().positive().optional(),
        thirdparty_name: z.string().trim().min(1).optional().describe("Customer or supplier name to resolve before scanning; if both filters are supplied they must identify the same thirdparty"),
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
    async ({ query, thirdparty_id, thirdparty_name, document_types, max_documents_per_type, limit }) => {
      let thirdpartyId = thirdparty_id;
      if (thirdparty_name) {
        const resolved = await resolveThirdparty(thirdparty_name);
        if (!resolved.ok) return resolved.error;
        if (thirdpartyId !== undefined && thirdpartyId !== resolved.id) {
          return { error: "VALIDATION_ERROR", message: "thirdparty_id and thirdparty_name identify different thirdparties." };
        }
        thirdpartyId = resolved.id;
      }
      return searchDocumentContent(
        {
          query,
          documentTypes: document_types as DocumentContentType[] | undefined,
          maxDocumentsPerType: max_documents_per_type,
          limit,
        },
        {
          domains: {
            proposal: {
              list: (count) => listProposals(recentDocumentParams(count, thirdpartyId)),
              get: getProposal,
            },
            order: {
              list: (count) => listOrders(
                recentDocumentParams(count, thirdpartyId),
                { suppressErrorStatuses: [403, 404] },
              ),
              get: getOrder,
            },
            client_invoice: {
              list: (count) => listInvoices(recentDocumentParams(count, thirdpartyId)),
              get: getInvoice,
            },
            supplier_invoice: {
              list: (count) => listSupplierInvoices(recentDocumentParams(count, thirdpartyId)),
              get: getSupplierInvoice,
            },
          },
          getThirdparty,
        },
      );
    },
  );
}
