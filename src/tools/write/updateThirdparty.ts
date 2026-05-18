import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { updateThirdparty } from "../../dolibarr/thirdparties.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import { toApiError } from "../../dolibarr/client.js";

export function registerUpdateThirdparty(server: McpServer): void {
  server.tool(
    "update_thirdparty",
    "Update an existing thirdparty (client or supplier) in Dolibarr.",
    {
      thirdparty: z.string().describe("Thirdparty name or Dolibarr ID to update"),
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      zip: z.string().optional(),
      town: z.string().optional(),
      vat_number: z.string().optional(),
    },
    async ({ thirdparty, name, email, phone, address, zip, town, vat_number }) => {
      try {
        const resolved = await resolveThirdparty(thirdparty);
        if (!resolved.ok) {
          return { content: [{ type: "text", text: JSON.stringify(resolved.error) }] };
        }

        const updated = await updateThirdparty(resolved.id, {
          name,
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
            text: JSON.stringify({ success: true, id: resolved.id, name: updated.name }),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify(toApiError(err)) }] };
      }
    },
  );
}
