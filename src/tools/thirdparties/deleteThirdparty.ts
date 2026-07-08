import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { listOrders } from "../../dolibarr/orders.js";
import { listProposals } from "../../dolibarr/proposals.js";
import { listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import { deleteThirdparty, getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { cleanString } from "../shared/normalization.js";
import { jsonContent } from "../shared/responses.js";
import { deleteDryRun, deletesDisabledResponse } from "../shared/deleteGuards.js";

type LinkedDocumentCounts = {
  invoices: number;
  proposals: number;
  supplier_invoices: number;
  orders: number;
};

function linkedDocumentParams(thirdpartyId: number): string {
  return dolibarrQueryString({
    sqlfilters: `(t.fk_soc:=:${thirdpartyId})`,
    limit: "10000",
    properties: "id",
    withLines: "false",
  });
}

async function countOrZero<T>(load: () => Promise<T[]>): Promise<number> {
  try {
    return (await load()).length;
  } catch (err) {
    if (isDolibarrNotFoundError(err)) return 0;
    throw err;
  }
}

async function linkedDocumentCounts(thirdpartyId: number): Promise<LinkedDocumentCounts> {
  const params = linkedDocumentParams(thirdpartyId);
  const [invoices, proposals, supplierInvoices, orders] = await Promise.all([
    countOrZero(() => listInvoices(params)),
    countOrZero(() => listProposals(params)),
    countOrZero(() => listSupplierInvoices(params)),
    countOrZero(() => listOrders(params)),
  ]);

  return {
    invoices,
    proposals,
    supplier_invoices: supplierInvoices,
    orders,
  };
}

function hasLinkedDocuments(linked: LinkedDocumentCounts): boolean {
  return Object.values(linked).some((count) => count > 0);
}

function linkedDocumentsResponse(name: string | undefined, linked: LinkedDocumentCounts): Record<string, unknown> {
  return {
    error: "HAS_LINKED_DOCUMENTS",
    message: `Thirdparty ${name ?? "record"} has linked documents.`,
    linked,
  };
}

export function registerDeleteThirdparty(server: McpServer): void {
  server.registerTool(
    "delete_thirdparty",
    {
      description: "Delete a thirdparty by numeric Dolibarr ID only. Never cascades linked documents.",
      inputSchema: {
        thirdparty_id: z.number().int().positive().describe("Dolibarr thirdparty ID"),
        confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
      },
    },
    async ({ thirdparty_id, confirm }) => {
      try {
        const disabled = deletesDisabledResponse();
        if (disabled) return jsonContent(disabled);

        const thirdparty = await getThirdparty(thirdparty_id);
        const name = cleanString(thirdparty.name);
        const linked = await linkedDocumentCounts(thirdparty_id);

        if (!confirm) {
          return jsonContent(deleteDryRun({
            entity_type: "thirdparty",
            id: thirdparty_id,
            name,
            linked,
          }));
        }

        if (hasLinkedDocuments(linked)) {
          return jsonContent(linkedDocumentsResponse(name, linked));
        }

        await deleteThirdparty(thirdparty_id);

        return jsonContent({
          success: true,
          deleted: true,
          thirdparty_id,
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
