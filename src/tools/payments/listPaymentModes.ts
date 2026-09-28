import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listPaymentModes } from "../../dolibarr/paymentOptions.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import {
  paymentModeAvailability,
  paymentModeSummary,
} from "../../dolibarr/documents/paymentOptionSummaries.js";

export function registerListPaymentModes(server: McpServer): void {
  registerJsonTool(
    server,
    "list_payment_modes",
    {
      description: "List active Dolibarr payment modes with their IDs, codes, and labels for invoice payments.",
      inputSchema: {
        invoice_type: z.enum(["all", "client", "supplier"]).default("all")
          .describe("Optionally show only modes applicable to client or supplier invoices"),
      },
      pretty: true,
      annotations: { readOnlyHint: true },
    },
    async ({ invoice_type }) => {
      const modes = await listPaymentModes();
      return modes
        .filter((mode) => invoice_type === "all" || paymentModeAvailability(mode).includes(invoice_type))
        .map(paymentModeSummary);
    },
  );
}
