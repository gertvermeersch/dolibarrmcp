import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { jsonContent } from "../shared/responses.js";
import {
  cleanString,
  compactObject,
  dolibarrId,
  isoDateFromTimestamp,
  isoInstantFromTimestamp,
  moneyOrZero,
  numberOrUndefined,
  remainingToPay,
} from "../shared/normalization.js";
import type { DolibarrInvoice, DolibarrThirdparty } from "../../types/dolibarr.js";

const agingBucketNames = ["0-30", "31-60", "61-90", "90+"] as const;
type AgingBucketName = typeof agingBucketNames[number];

type AgingBucketTotals = Record<AgingBucketName, {
  amount: number;
  count: number;
}>;

const pageSize = 100;

function emptyAgingBuckets(): AgingBucketTotals {
  return {
    "0-30": { amount: 0, count: 0 },
    "31-60": { amount: 0, count: 0 },
    "61-90": { amount: 0, count: 0 },
    "90+": { amount: 0, count: 0 },
  };
}

function isOpenInvoice(invoice: DolibarrInvoice): boolean {
  return Number(invoice.statut) === 1 && remainingToPay(invoice) > 0;
}

function invoiceTimestamp(invoice: DolibarrInvoice): number | undefined {
  return numberOrUndefined(invoice.date_lim_reglement) ?? numberOrUndefined(invoice.date);
}

function daysOverdue(invoice: DolibarrInvoice, asOfSeconds: number): number {
  const dueDate = invoiceTimestamp(invoice);
  if (dueDate === undefined || dueDate <= 0) return 0;
  return Math.max(0, Math.floor((asOfSeconds - dueDate) / 86_400));
}

function agingBucket(days: number): AgingBucketName {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function addToBucket(buckets: AgingBucketTotals, bucket: AgingBucketName, amount: number): void {
  buckets[bucket].amount = moneyOrZero(buckets[bucket].amount + amount);
  buckets[bucket].count += 1;
}

async function listOpenValidatedInvoices(): Promise<DolibarrInvoice[]> {
  const invoices: DolibarrInvoice[] = [];

  for (let page = 0; ; page += 1) {
    const pageInvoices = await listInvoices(dolibarrQueryString({
      sqlfilters: "(t.fk_statut:=:1)",
      sortfield: "t.date_lim_reglement,t.rowid",
      sortorder: "ASC,ASC",
      limit: String(pageSize),
      page: String(page),
    }));

    invoices.push(...pageInvoices.filter(isOpenInvoice));

    if (pageInvoices.length < pageSize) {
      break;
    }
  }

  return invoices;
}

async function resolveClients(invoices: DolibarrInvoice[]): Promise<Map<number, DolibarrThirdparty>> {
  const clientIds = Array.from(new Set(invoices.map((invoice) => dolibarrId(invoice.socid))));
  const clients = await Promise.all(clientIds.map((id) => getThirdparty(id)));
  return new Map(clients.map((client) => [Number(client.id), client]));
}

export function registerGetOutstandingReceivables(server: McpServer): void {
  server.registerTool(
    "get_outstanding_receivables",
    {
      description: "Get all unpaid client invoices grouped by client, with aging buckets (0-30, 31-60, 61-90, 90+ days).",
      inputSchema: {},
    },
    async () => {
      try {
        const asOfSeconds = Math.floor(Date.now() / 1000);
        const invoices = await listOpenValidatedInvoices();
        const clients = await resolveClients(invoices);
        const totals = emptyAgingBuckets();
        const clientsById = new Map<number, {
          client: DolibarrThirdparty | undefined;
          invoice_count: number;
          total_outstanding: number;
          aging_buckets: AgingBucketTotals;
          invoices: Array<{
            id: number;
            ref: string;
            status: string;
            date?: string;
            due_date?: string;
            days_overdue: number;
            aging_bucket: AgingBucketName;
            total_including_tax: number;
            remaining_to_pay: number;
          }>;
        }>();

        for (const invoice of invoices) {
          const clientId = dolibarrId(invoice.socid);
          const amount = remainingToPay(invoice);
          if (amount <= 0) continue;

          const overdueDays = daysOverdue(invoice, asOfSeconds);
          const bucket = agingBucket(overdueDays);
          let group = clientsById.get(clientId);

          if (!group) {
            group = {
              client: clients.get(clientId),
              invoice_count: 0,
              total_outstanding: 0,
              aging_buckets: emptyAgingBuckets(),
              invoices: [],
            };
            clientsById.set(clientId, group);
          }

          group.invoice_count += 1;
          group.total_outstanding = moneyOrZero(group.total_outstanding + amount);
          addToBucket(group.aging_buckets, bucket, amount);
          addToBucket(totals, bucket, amount);
          group.invoices.push({
            id: dolibarrId(invoice.id),
            ref: invoice.ref,
            status: invoiceStatusLabel(invoice.statut) ?? "unknown",
            date: isoDateFromTimestamp(invoice.date),
            due_date: isoDateFromTimestamp(invoice.date_lim_reglement),
            days_overdue: overdueDays,
            aging_bucket: bucket,
            total_including_tax: moneyOrZero(invoice.total_ttc),
            remaining_to_pay: amount,
          });
        }

        const clientsPayload = Array.from(clientsById.entries())
          .map(([clientId, group]) => ({
            client: compactObject({
              id: clientId,
              name: cleanString(group.client?.name),
              email: cleanString(group.client?.email),
              phone: cleanString(group.client?.phone),
            }),
            invoice_count: group.invoice_count,
            total_outstanding: moneyOrZero(group.total_outstanding),
            aging_buckets: group.aging_buckets,
            invoices: group.invoices,
          }))
          .sort((left, right) => right.total_outstanding - left.total_outstanding);

        return jsonContent({
          as_of: isoInstantFromTimestamp(asOfSeconds),
          client_count: clientsPayload.length,
          invoice_count: clientsPayload.reduce((sum, client) => sum + client.invoice_count, 0),
          total_outstanding: moneyOrZero(clientsPayload.reduce((sum, client) => sum + client.total_outstanding, 0)),
          aging_buckets: totals,
          clients: clientsPayload,
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
