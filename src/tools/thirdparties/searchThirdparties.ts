import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getThirdpartyClientFlag,
  getThirdpartySupplierFlag,
  getThirdpartyType,
  searchThirdparties,
} from "../../dolibarr/thirdparties.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";

export function registerSearchThirdparties(server: McpServer): void {
  server.tool(
    "search_thirdparties",
    "Search Dolibarr third parties only, with an optional filter for clients or suppliers.",
    {
      query: z.string().describe("Third party name to search for"),
      kind: z.enum(["all", "clients", "suppliers"])
        .default("all")
        .describe("Limit results to all third parties, clients, or suppliers"),
    },
    async ({ query, kind }) => {
      try {
        const thirdparties = await searchThirdparties(query, kind);

        return prettyJsonContent(thirdparties.map((thirdparty) => ({
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
        })));
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
