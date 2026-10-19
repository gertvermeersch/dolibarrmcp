import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveContract } from "../../resolvers/contract.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { contractStatusLabel } from "../../dolibarr/statusLabels.js";
import {
  annualValueExclTax,
  contractEndDate,
  contractStartDate,
  daysBetweenIso,
  hasRenewalInvoice,
  hasRunningServices,
  todayIso,
} from "../../dolibarr/maintenance/contractRules.js";
import { loadContractDetail } from "../../dolibarr/maintenance/contractReadService.js";
import { compactObject, dolibarrId } from "../shared/normalization.js";
import { interventionsUnavailableWarning } from "../shared/maintenanceSerializers.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import {
  serializeContractLine,
  serializeIntervention,
  serializeLinkedInvoice,
} from "../shared/maintenanceSerializers.js";
import { serializeThirdpartyIdentity } from "../shared/serializers.js";

export function registerGetContractDetail(server: McpServer): void {
  registerJsonTool(
    server,
    "get_contract_detail",
    {
      description: "Get a contract by reference or ID: lines with status and dates, linked invoices with payment status (renewal invoices are flagged), and linked interventions.",
      annotations: { readOnlyHint: true },
      pretty: true,
      inputSchema: { contract: z.string().describe("Contract reference (e.g. CT2501-0003) or Dolibarr ID") },
    },
    async ({ contract: contractInput }) => {
      const resolved = await resolveContract(contractInput);
      if (!resolved.ok) return resolved.error;

      const { contract, invoices, interventions, available } = await loadContractDetail(resolved.contract);
      const client = await getThirdparty(Number(contract.socid));
      const today = todayIso();
      const lines = contract.lines ?? [];
      const start = contractStartDate(contract);
      const end = contractEndDate(lines);

      return {
        id: dolibarrId(contract.id),
        ref: contract.ref,
        status: contractStatusLabel(contract.statut ?? contract.status),
        running: hasRunningServices(lines),
        client: serializeThirdpartyIdentity(client),
        dates: compactObject({
          start,
          end,
          days_until_end: end ? daysBetweenIso(today, end) : undefined,
        }),
        annual_value_excluding_tax: annualValueExclTax(lines),
        renewal_invoiced: hasRenewalInvoice(start, invoices),
        lines: lines.map((line) => serializeContractLine(line, today)),
        invoices: invoices.map((invoice) => serializeLinkedInvoice(invoice, start)),
        interventions: interventions.map((intervention) => serializeIntervention(intervention)),
        ...(available ? {} : { interventions_available: false, warning: interventionsUnavailableWarning }),
      };
    },
  );
}
