import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listBankAccounts } from "../../dolibarr/paymentOptions.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { bankAccountSummary } from "../../dolibarr/documents/paymentOptionSummaries.js";

export function registerListBankAccounts(server: McpServer): void {
  registerJsonTool(
    server,
    "list_bank_accounts",
    {
      description: "List Dolibarr bank accounts available for recording invoice payments, including labels, bank names, currencies, and masked account identifiers.",
      inputSchema: {
        include_closed: z.boolean().default(false).describe("Include closed bank accounts"),
      },
      pretty: true,
      annotations: { readOnlyHint: true },
    },
    async ({ include_closed }) =>
      (await listBankAccounts({ includeClosed: include_closed })).map(bankAccountSummary),
  );
}
