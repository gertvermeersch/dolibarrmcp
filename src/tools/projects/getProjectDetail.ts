import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  groupHours,
  lastEntryDate,
  loadProjectDetail,
  totalHours,
} from "../../dolibarr/projects/projectReadService.js";
import { optionalMoney, taskHours } from "../../dolibarr/projects/projectRules.js";
import { invoiceStatusLabel, orderStatusLabel, proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { resolveProject } from "../../resolvers/project.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { money, numberOrUndefined } from "../shared/normalization.js";
import { serializeProjectDetail, serializeTask, serializeTimeEntry, timeEntryUserName } from "../shared/projectSerializers.js";
import { serializeClientDocumentSummary } from "../shared/serializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { projectInputSchema } from "./projectSchemas.js";
import type { DolibarrInvoice, DolibarrProposal } from "../../types/dolibarr.js";

const recentEntryCount = 10;
// Proposal 2 = accepted, 4 = billed; invoice 1 = validated, 2 = paid.
const signedProposalStatuses = new Set([2, 4]);
const countedInvoiceStatuses = new Set([1, 2]);

function sumExcludingTax(documents: Array<DolibarrProposal | DolibarrInvoice>, statuses: Set<number>): number {
  return money(documents
    .filter((document) => statuses.has(numberOrUndefined(document.statut ?? (document as { status?: unknown }).status) ?? -1))
    .reduce((sum, document) => sum + (numberOrUndefined(document.total_ht) ?? 0), 0)) ?? 0;
}

function sumHours(values: Array<number | undefined>): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? Math.round(known.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined;
}

export function registerGetProjectDetail(server: McpServer): void {
  registerJsonTool(server, "get_project_detail", {
    description: "Full picture of one project or lead: header and lead info, tasks with planned vs. spent hours and progress, time logged (total, per user, most recent entries), and linked proposals, orders, client invoices and supplier invoices with totals.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: { project: projectInputSchema },
  }, async ({ project: projectInput }) => {
    const resolved = await resolveProject(projectInput);
    if (!resolved.ok) return resolved.error;
    const project = resolved.project;

    const { tasks, timeEntries, documents } = await loadProjectDetail(project);
    const names = await resolveMissingThirdpartyNames([
      ...[project.socid, ...[...documents.proposals, ...documents.orders, ...documents.invoices, ...documents.supplierInvoices].map((d) => d.socid)]
        .flatMap((id) => numberOrUndefined(id) ?? [])
        .filter((id) => id > 0),
    ]);

    const hoursPerTask = tasks.map(taskHours);

    return {
      project: serializeProjectDetail(project, names),
      tasks: tasks.map(serializeTask),
      hours: {
        planned: sumHours(hoursPerTask.map((hours) => hours.planned)),
        spent: totalHours(timeEntries),
        time_entries: timeEntries.length,
        last_entry_date: lastEntryDate(timeEntries),
        by_user: groupHours(timeEntries, (row) => timeEntryUserName(row) ?? `user ${row.fk_user}`)
          .map(({ key, hours, entries }) => ({ user: key, hours, entries })),
      },
      recent_time_entries: timeEntries.slice(0, recentEntryCount).map(serializeTimeEntry),
      documents: {
        proposals: documents.proposals.map((d) => serializeClientDocumentSummary(d, proposalStatusLabel(d.statut) ?? "unknown", names)),
        orders: documents.orders.map((d) => serializeClientDocumentSummary(d, orderStatusLabel(d.statut ?? d.status) ?? "unknown", names)),
        invoices: documents.invoices.map((d) => serializeClientDocumentSummary(d, invoiceStatusLabel(d.statut) ?? "unknown", names)),
        supplier_invoices: documents.supplierInvoices.map((d) => serializeClientDocumentSummary(d, invoiceStatusLabel(d.statut) ?? "unknown", names)),
      },
      totals: {
        budget: optionalMoney(project.budget_amount),
        proposals_signed_excl_tax: sumExcludingTax(documents.proposals, signedProposalStatuses),
        invoiced_excl_tax: sumExcludingTax(documents.invoices, countedInvoiceStatuses),
        supplier_costs_excl_tax: sumExcludingTax(documents.supplierInvoices, countedInvoiceStatuses),
      },
    };
  });
}
