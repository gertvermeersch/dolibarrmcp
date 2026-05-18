import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createThirdparty } from "../../dolibarr/thirdparties.js";
import { toApiError } from "../../dolibarr/client.js";

export function registerCreateThirdparty(server: McpServer): void {
  server.tool(
    "create_thirdparty",
    "Create a new thirdparty (client and/or supplier) in Dolibarr.",
    {
      name: z.string().describe("Company or person name"),
      is_client: z.boolean().default(false).describe("Mark as client"),
      is_supplier: z.boolean().default(false).describe("Mark as supplier"),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      zip: z.string().optional(),
      town: z.string().optional(),
      vat_number: z.string().optional().describe("VAT / BTW number"),
    },
    async ({ name, is_client, is_supplier, email, phone, address, zip, town, vat_number }) => {
      try {
        const id = await createThirdparty({
          name,
          client: is_client ? 1 : 0,
          supplier: is_supplier ? 1 : 0,
          email,
          phone,
          address,
          zip,
          town,
          tva_intra: vat_number,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, id, name }),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify(toApiError(err)) }] };
      }
    },
  );
}
