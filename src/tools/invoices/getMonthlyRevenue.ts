import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { jsonContent } from "../shared/responses.js";
import {
  dolibarrId,
  isoDateFromTimestamp,
  money,
  moneyOrZero,
  numberOrUndefined,
  numberOrZero,
} from "../shared/normalization.js";
import type { DolibarrInvoice } from "../../types/dolibarr.js";

const revenueStatuses = new Set([1, 2]);
const pageSize = 100;

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthDateRange(year: number, month: number): { startDate: string; exclusiveEndDate: string } {
  return {
    startDate: dateOnly(new Date(Date.UTC(year, month - 1, 1))),
    exclusiveEndDate: dateOnly(new Date(Date.UTC(year, month, 1))),
  };
}

function isRevenueInvoice(invoice: DolibarrInvoice): boolean {
  return revenueStatuses.has(Number(invoice.statut));
}

async function listMonthlyRevenueInvoices(year: number, month: number): Promise<DolibarrInvoice[]> {
  const { startDate, exclusiveEndDate } = monthDateRange(year, month);
  const invoices: DolibarrInvoice[] = [];

  for (let page = 0; ; page += 1) {
    const pageInvoices = await listInvoices(dolibarrQueryString({
      sqlfilters: `((t.datef:>=:${dolibarrStringLiteral(startDate)}) and (t.datef:<:${dolibarrStringLiteral(exclusiveEndDate)}))`,
      sortfield: "t.datef,t.rowid",
      sortorder: "ASC,ASC",
      limit: String(pageSize),
      page: String(page),
    }));

    invoices.push(...pageInvoices.filter(isRevenueInvoice));

    if (pageInvoices.length < pageSize) {
      break;
    }
  }

  return invoices;
}

export function registerGetMonthlyRevenue(server: McpServer): void {
  server.registerTool(
    "get_monthly_revenue",
    {
      description: "Get finalized client invoice revenue totals for a given month, excluding drafts and abandoned invoices.",
      inputSchema: {
        year: z.number().int().describe("Year (e.g. 2025)"),
        month: z.number().int().min(1).max(12).describe("Month (1-12)"),
        include_invoices: z.boolean().default(false).describe("Include the individual invoices that make up the monthly totals"),
      },
    },
    async ({ year, month, include_invoices }) => {
      try {
        const { startDate, exclusiveEndDate } = monthDateRange(year, month);
        const invoices = await listMonthlyRevenueInvoices(year, month);

        const totals = invoices.reduce(
          (sum, invoice) => {
            const totalHt = numberOrZero(invoice.total_ht);
            const totalTtc = numberOrZero(invoice.total_ttc);
            const totalTva = numberOrUndefined(invoice.total_tva) ?? totalTtc - totalHt;

            sum.total_ht += totalHt;
            sum.total_tva += totalTva;
            sum.total_ttc += totalTtc;
            return sum;
          },
          { total_ht: 0, total_tva: 0, total_ttc: 0 },
        );

        const statusCounts = invoices.reduce<Record<string, number>>((counts, invoice) => {
          const status = invoiceStatusLabel(invoice.statut) ?? "unknown";
          counts[status] = (counts[status] ?? 0) + 1;
          return counts;
        }, {});

        const response = {
          period: {
            year,
            month,
            start_date: startDate,
            exclusive_end_date: exclusiveEndDate,
          },
          invoice_count: invoices.length,
          status_counts: statusCounts,
          totals: {
            total_excluding_tax: moneyOrZero(totals.total_ht),
            total_tax: moneyOrZero(totals.total_tva),
            total_including_tax: moneyOrZero(totals.total_ttc),
          },
        };

        return jsonContent(include_invoices ? {
          ...response,
          invoices: invoices.map((invoice) => ({
            id: dolibarrId(invoice.id),
            ref: invoice.ref,
            status: invoiceStatusLabel(invoice.statut),
            date: isoDateFromTimestamp(invoice.date),
            total_excluding_tax: moneyOrZero(invoice.total_ht),
            total_tax: money(numberOrUndefined(invoice.total_tva) ?? numberOrZero(invoice.total_ttc) - numberOrZero(invoice.total_ht)),
            total_including_tax: moneyOrZero(invoice.total_ttc),
          })),
        } : response);
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
